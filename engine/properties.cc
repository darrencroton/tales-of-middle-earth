/*
 * The hero's properties, for the character sheet's census: every bonus,
 * resistance, protection, trait and sense tome2 gives a hero, whether the
 * hero has it now (as calc_bonuses leaves p_ptr) and what gives it: each
 * piece of equipment known, the race, its modifier and the class (their
 * level flags), skills, the god, corruptions, the form taken, the
 * creature carried and the timed effects. tome2 keeps no record of where a
 * property comes from, so each source is worked out as calc_bonuses (and
 * calc_torch, calc_gods, calc_corruptions, calc_body_bonus,
 * calc_wield_monster) applies it.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "artifact_type.hpp"
#include "body.hpp"
#include "corrupt.hpp"
#include "defines.hpp"
#include "deity_type.hpp"
#include "game.hpp"
#include "gods.hpp"
#include "mimic.hpp"
#include "monster_race.hpp"
#include "monster_race_flag.hpp"
#include "object1.hpp"
#include "object2.hpp"
#include "object_flag.hpp"
#include "object_kind.hpp"
#include "object_type.hpp"
#include "player_class.hpp"
#include "player_race.hpp"
#include "player_race_flag.hpp"
#include "player_race_mod.hpp"
#include "player_type.hpp"
#include "set_type.hpp"
#include "skill_descriptor.hpp"
#include "skills.hpp"
#include "skills_defs.hpp"
#include "stats.hpp"
#include "tables.hpp"
#include "variable.hpp"
#include "xtra1.hpp"

#include "json.hpp"

#include <emscripten.h>

#include <algorithm>
#include <cstring>
#include <array>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

/* tome2's xtra1.cc */
int get_archery_skill();
int get_weaponmastery_skill();
void analyze_blow(int *num, int *wgt, int *mul);

/* engine/snapshot.cc */
JsonWriter start_json();
bool begin_ready(JsonWriter &w);
extern std::string json;

namespace {

/* Flags applied together with one pval, as apply_flags takes them. */
struct part {
	object_flag_set flags;
	int pval = 0;
};

/* Where properties come from, and what each adds. */
struct source {
	explicit source(char const *kind, std::string name = {}) : kind(kind), name(std::move(name)) {}

	char const *kind;
	std::string name;
	/* An item's place in the inventory. */
	int item = -1;
	/* The form taken by mimicry, whose bonuses calc_mimic adds directly. */
	bool mimic = false;
	/* The timed effect behind it (an id of json_effects), and the turns it has left. */
	char const *effect = nullptr;
	int turns = 0;
	std::vector<part> parts;
	/* Amounts added that no object flag carries (racial stat adjustments, haste, a god's speed). */
	std::map<std::string, int> nums;
	/* Properties no object flag carries (holding time and space, a race hurt by light), with how. */
	std::map<std::string, char const *> grants;

	/* Every flag, with calc_bonuses' implications: chaos resistance resists confusion, flight levitates, breathing without air breathes water. */
	object_flag_set flags() const
	{
		object_flag_set f;
		for (auto const &p : parts) f |= p.flags;
		if (f & TR_RES_CHAOS) f |= TR_RES_CONF;
		if (f & TR_FLY) f |= TR_FEATHER;
		if (f & TR_MAGIC_BREATH) f |= TR_WATER_BREATH;
		return f;
	}
};

/* How a flag counts for a property: as what ("immune", "vulnerable", or plain), and how much each pval adds (`scale`) or the flag alone (`fixed`). */
struct prop_flag {
	prop_flag(object_flag_set const &flag, char const *as = "", int scale = 0, int fixed = 0) : flag(flag), as(as), scale(scale), fixed(fixed) {}

	object_flag_set flag;
	char const *as;
	int scale;
	int fixed;
};

enum class prop_kind { flag, grade, number };

struct prop {
	prop(char const *id, prop_kind kind, std::vector<prop_flag> flags, int (*now)(), bool known = true) : id(id), kind(kind), flags(std::move(flags)), now(now), known(known) {}

	char const *id;
	prop_kind kind;
	std::vector<prop_flag> flags;
	/* The hero's state now: 1 or 0, an element's grade (3 immune, 2 doubly resisted, 1 resisted, -1 vulnerable), or the amount. */
	int (*now)();
	/* Whether `now` is known for a number (else the sources' sum is its value). */
	bool known;
};

int grade(bool immune, bool resist, bool oppose, bool vulnerable)
{
	if (immune) return 3;
	if (resist && oppose) return 2;
	if (resist || oppose) return 1;
	return vulnerable ? -1 : 0;
}

int has(object_flag_set const &f)
{
	return (p_ptr->computed_flags & f) ? 1 : 0;
}

/* Every property of the census, in no particular order (the frontend lays them out). */
std::vector<prop> const &props()
{
	static std::vector<prop> const all = {
		{ "str", prop_kind::number, { { TR_STR, "", 1 } }, [] { return int(p_ptr->stat_add[A_STR]); } },
		{ "int", prop_kind::number, { { TR_INT, "", 1 } }, [] { return int(p_ptr->stat_add[A_INT]); } },
		{ "wis", prop_kind::number, { { TR_WIS, "", 1 } }, [] { return int(p_ptr->stat_add[A_WIS]); } },
		{ "dex", prop_kind::number, { { TR_DEX, "", 1 } }, [] { return int(p_ptr->stat_add[A_DEX]); } },
		{ "con", prop_kind::number, { { TR_CON, "", 1 } }, [] { return int(p_ptr->stat_add[A_CON]); } },
		{ "chr", prop_kind::number, { { TR_CHR, "", 1 } }, [] { return int(p_ptr->stat_add[A_CHR]); } },
		{ "speed", prop_kind::number, { { TR_SPEED, "", 1 } }, [] { return p_ptr->pspeed - 110; } },
		{ "stealth", prop_kind::number, { { TR_STEALTH, "", 1 } }, nullptr, false },
		{ "tunnel", prop_kind::number, { { TR_TUNNEL, "", 1 } }, nullptr, false },
		{ "blows", prop_kind::number, { { TR_BLOWS, "", 1 } }, [] { return int(p_ptr->num_blow); } },
		{ "crit", prop_kind::number, { { TR_CRIT, "", 1 } }, [] { return int(p_ptr->xtra_crit); } },
		{ "shots", prop_kind::number, { { TR_XTRA_SHOTS, "", 0, 1 } }, [] { return int(p_ptr->num_fire); } },
		{ "might", prop_kind::number, { { TR_XTRA_MIGHT, "", 1 } }, [] { return int(p_ptr->xtra_might); } },
		{ "spell", prop_kind::number, { { TR_SPELL, "", 1 } }, [] { return int(p_ptr->to_s); } },
		{ "mana", prop_kind::number, { { TR_MANA, "", 20 } }, [] { return p_ptr->to_m * 20; } },
		{ "life", prop_kind::number, { { TR_LIFE, "", 20 } }, [] { return p_ptr->to_l * 20; } },
		{ "luck", prop_kind::number, { { TR_LUCK, "", 1 } }, [] { return int(p_ptr->luck_cur); } },
		{ "infra", prop_kind::number, { { TR_INFRA, "", 10 } }, [] { return p_ptr->see_infra * 10; } },
		{ "light", prop_kind::number, {}, [] { return int(p_ptr->cur_lite); } },
		{ "invis", prop_kind::number, { { TR_INVIS, "", 10 } }, [] { return int(p_ptr->invis); } },
		{ "antimagicField", prop_kind::number, {}, [] { return int(p_ptr->antimagic); } },

		{ "acid", prop_kind::grade, { { TR_IM_ACID, "immune" }, { TR_RES_ACID } }, [] { return grade(p_ptr->immune_acid, p_ptr->resist_acid, p_ptr->oppose_acid > 0, false); } },
		{ "elec", prop_kind::grade, { { TR_IM_ELEC, "immune" }, { TR_RES_ELEC } }, [] { return grade(p_ptr->immune_elec, p_ptr->resist_elec, p_ptr->oppose_elec > 0, false); } },
		{ "fire", prop_kind::grade, { { TR_IM_FIRE, "immune" }, { TR_RES_FIRE }, { TR_SENS_FIRE, "vulnerable" } }, [] { return grade(p_ptr->immune_fire, p_ptr->resist_fire, p_ptr->oppose_fire > 0, p_ptr->sensible_fire); } },
		{ "cold", prop_kind::grade, { { TR_IM_COLD, "immune" }, { TR_RES_COLD } }, [] { return grade(p_ptr->immune_cold, p_ptr->resist_cold, p_ptr->oppose_cold > 0, false); } },
		{ "pois", prop_kind::grade, { { TR_RES_POIS } }, [] { return grade(false, p_ptr->resist_pois, p_ptr->oppose_pois > 0, false); } },
		{ "lite", prop_kind::grade, { { TR_RES_LITE } }, [] { return grade(false, p_ptr->resist_lite, false, p_ptr->sensible_lite); } },
		{ "dark", prop_kind::grade, { { TR_RES_DARK } }, [] { return grade(false, p_ptr->resist_dark, false, false); } },
		{ "sound", prop_kind::grade, { { TR_RES_SOUND } }, [] { return grade(false, p_ptr->resist_sound, false, false); } },
		{ "shards", prop_kind::grade, { { TR_RES_SHARDS } }, [] { return grade(false, p_ptr->resist_shard, false, false); } },
		{ "nether", prop_kind::grade, { { TR_IM_NETHER, "immune" }, { TR_RES_NETHER } }, [] { return grade(p_ptr->immune_neth, p_ptr->resist_neth, false, false); } },
		{ "nexus", prop_kind::grade, { { TR_RES_NEXUS } }, [] { return grade(false, p_ptr->resist_nexus, false, false); } },
		{ "chaos", prop_kind::grade, { { TR_RES_CHAOS } }, [] { return grade(false, p_ptr->resist_chaos, false, false); } },
		{ "disen", prop_kind::grade, { { TR_RES_DISEN } }, [] { return grade(false, p_ptr->resist_disen, false, false); } },
		{ "time", prop_kind::flag, {}, [] { return int(p_ptr->resist_continuum); } },

		{ "fear", prop_kind::flag, { { TR_RES_FEAR } }, [] { return int(p_ptr->resist_fear); } },
		{ "conf", prop_kind::flag, { { TR_RES_CONF } }, [] { return int(p_ptr->resist_conf); } },
		{ "blind", prop_kind::flag, { { TR_RES_BLIND } }, [] { return int(p_ptr->resist_blind); } },
		{ "paralysis", prop_kind::flag, { { TR_FREE_ACT } }, [] { return int(p_ptr->free_act); } },
		{ "holdLife", prop_kind::flag, { { TR_HOLD_LIFE } }, [] { return int(p_ptr->hold_life); } },
		{ "stun", prop_kind::flag, {}, [] { return int(race_flags_p(PR_NO_STUN) || p_ptr->tim_roots > 0); } },
		{ "cuts", prop_kind::flag, {}, [] { return int(race_flags_p(PR_NO_CUT)); } },
		{ "blackBreathResist", prop_kind::flag, {}, [] { return int(race_flags_p(PR_RESIST_BLACK_BREATH)); } },
		{ "sustStr", prop_kind::flag, { { TR_SUST_STR } }, [] { return int(p_ptr->sustain_str); } },
		{ "sustInt", prop_kind::flag, { { TR_SUST_INT } }, [] { return int(p_ptr->sustain_int); } },
		{ "sustWis", prop_kind::flag, { { TR_SUST_WIS } }, [] { return int(p_ptr->sustain_wis); } },
		{ "sustDex", prop_kind::flag, { { TR_SUST_DEX } }, [] { return int(p_ptr->sustain_dex); } },
		{ "sustCon", prop_kind::flag, { { TR_SUST_CON } }, [] { return int(p_ptr->sustain_con); } },
		{ "sustChr", prop_kind::flag, { { TR_SUST_CHR } }, [] { return int(p_ptr->sustain_chr); } },
		{ "reflect", prop_kind::flag, { { TR_REFLECT } }, [] { return int(p_ptr->reflect); } },
		{ "regen", prop_kind::flag, { { TR_REGEN } }, [] { return int(p_ptr->regenerate || p_ptr->tim_regen > 0); } },
		{ "auraFire", prop_kind::flag, { { TR_SH_FIRE } }, [] { return int(p_ptr->sh_fire); } },
		{ "auraElec", prop_kind::flag, { { TR_SH_ELEC } }, [] { return int(p_ptr->sh_elec); } },

		{ "feather", prop_kind::flag, { { TR_FEATHER } }, [] { return int(p_ptr->ffall); } },
		{ "fly", prop_kind::flag, { { TR_FLY } }, [] { return int(p_ptr->fly); } },
		{ "climb", prop_kind::flag, { { TR_CLIMB } }, [] { return int(p_ptr->climb); } },
		{ "wraith", prop_kind::flag, { { TR_WRAITH } }, [] { return int(p_ptr->wraith_form || race_flags_p(PR_SEMI_WRAITH)); } },
		{ "waterBreath", prop_kind::flag, { { TR_WATER_BREATH } }, [] { return int(p_ptr->water_breath); } },
		{ "magicBreath", prop_kind::flag, { { TR_MAGIC_BREATH } }, [] { return int(p_ptr->magical_breath); } },
		{ "slowDigest", prop_kind::flag, { { TR_SLOW_DIGEST } }, [] { return int(p_ptr->slow_digest); } },

		{ "aggravate", prop_kind::flag, { { TR_AGGRAVATE } }, [] { return int(p_ptr->aggravate); } },
		{ "teleport", prop_kind::flag, { { TR_TELEPORT } }, [] { return int(p_ptr->teleport); } },
		{ "noTeleport", prop_kind::flag, { { TR_NO_TELE } }, [] { return int(p_ptr->anti_tele); } },
		{ "noMagic", prop_kind::flag, { { TR_NO_MAGIC } }, [] { return int(p_ptr->anti_magic); } },
		{ "drainExp", prop_kind::flag, { { TR_DRAIN_EXP } }, [] { return int(p_ptr->exp_drain); } },
		{ "drainMana", prop_kind::flag, { { TR_DRAIN_MANA } }, [] { return int(p_ptr->drain_mana > 0); } },
		{ "drainLife", prop_kind::flag, { { TR_DRAIN_HP } }, [] { return int(p_ptr->drain_life > 0); } },
		{ "blackBreath", prop_kind::flag, { { TR_BLACK_BREATH } }, [] { return int(p_ptr->black_breath); } },
		{ "tyCurse", prop_kind::flag, { { TR_TY_CURSE } }, [] { return has(TR_TY_CURSE); } },
		{ "dgCurse", prop_kind::flag, { { TR_DG_CURSE } }, [] { return has(TR_DG_CURSE); } },
		{ "autoCurse", prop_kind::flag, { { TR_AUTO_CURSE } }, [] { return has(TR_AUTO_CURSE); } },
		{ "neverBlow", prop_kind::flag, { { TR_NEVER_BLOW } }, [] { return has(TR_NEVER_BLOW); } },
		{ "immovable", prop_kind::flag, { { TR_IMMOVABLE } }, [] { return int(p_ptr->immovable); } },

		{ "seeInvis", prop_kind::flag, { { TR_SEE_INVIS } }, [] { return int(p_ptr->see_inv); } },
		{ "precog", prop_kind::flag, { { TR_PRECOGNITION } }, [] { return int(p_ptr->precognition); } },
		{ "esp", prop_kind::flag, { { ESP_ALL } }, [] { return has(ESP_ALL); } },
		{ "espOrc", prop_kind::flag, { { ESP_ORC } }, [] { return has(ESP_ORC); } },
		{ "espTroll", prop_kind::flag, { { ESP_TROLL } }, [] { return has(ESP_TROLL); } },
		{ "espDragon", prop_kind::flag, { { ESP_DRAGON } }, [] { return has(ESP_DRAGON); } },
		{ "espGiant", prop_kind::flag, { { ESP_GIANT } }, [] { return has(ESP_GIANT); } },
		{ "espDemon", prop_kind::flag, { { ESP_DEMON } }, [] { return has(ESP_DEMON); } },
		{ "espUndead", prop_kind::flag, { { ESP_UNDEAD } }, [] { return has(ESP_UNDEAD); } },
		{ "espEvil", prop_kind::flag, { { ESP_EVIL } }, [] { return has(ESP_EVIL); } },
		{ "espAnimal", prop_kind::flag, { { ESP_ANIMAL } }, [] { return has(ESP_ANIMAL); } },
		{ "espThunderlord", prop_kind::flag, { { ESP_THUNDERLORD } }, [] { return has(ESP_THUNDERLORD); } },
		{ "espGood", prop_kind::flag, { { ESP_GOOD } }, [] { return has(ESP_GOOD); } },
		{ "espNonliving", prop_kind::flag, { { ESP_NONLIVING } }, [] { return has(ESP_NONLIVING); } },
		{ "espUnique", prop_kind::flag, { { ESP_UNIQUE } }, [] { return has(ESP_UNIQUE); } },
		{ "espSpider", prop_kind::flag, { { ESP_SPIDER } }, [] { return has(ESP_SPIDER); } },
	};
	return all;
}

/* What a source adds to a property: the strongest way it counts ("immune" over plain), and the amount for a number. */
struct share {
	bool counts = false;
	char const *as = "";
	int n = 0;
};

share share_of(source const &s, prop const &p)
{
	share out;
	auto const flags = s.flags();
	for (auto const &pf : p.flags)
	{
		if (!(flags & pf.flag)) continue;
		out.counts = true;
		if (*pf.as && (!*out.as || !std::strcmp(pf.as, "immune"))) out.as = pf.as;
		if (pf.fixed) out.n += pf.fixed;
		if (pf.scale)
		{
			for (auto const &pt : s.parts)
			{
				if (pt.flags & pf.flag) out.n += pt.pval * pf.scale;
			}
		}
	}
	if (auto it = s.nums.find(p.id); it != s.nums.end() && it->second)
	{
		out.counts = true;
		out.n += it->second;
	}
	if (auto it = s.grants.find(p.id); it != s.grants.end())
	{
		out.counts = true;
		if (*it->second) out.as = it->second;
	}
	/* A number counts only by what it adds. */
	if (p.kind == prop_kind::number && !out.n) out.counts = false;
	return out;
}

/* The light an item or a trait gives (calc_torch): 1, 2 and 3 for its light flags. */
int lite_radius(object_flag_set const &f)
{
	return ((f & TR_LITE1) ? 1 : 0) + ((f & TR_LITE2) ? 2 : 0) + ((f & TR_LITE3) ? 3 : 0);
}

/* Level flags up to the hero's level, each level's flags with its own pval (apply_lflags). */
template<class LF>
void add_lflags(source &s, LF const &lflags)
{
	for (int i = 1; i <= p_ptr->lev; i++)
	{
		if (lflags[i].oflags.empty() && !lflags[i].pval) continue;
		s.parts.push_back({ lflags[i].oflags, lflags[i].pval });
	}
}

void add_stats(source &s, std::array<s16b, 6> const &adj)
{
	static char const *const ids[] = { "str", "int", "wis", "dex", "con", "chr" };
	for (int i = 0; i < 6; i++) s.nums[ids[i]] += adj[i];
}

std::string skill_name(int skill)
{
	return game->edit_data.s_descriptors[skill].name;
}

/* The equipment, each piece known with its own and its set's flags (calc_bonuses, apply_set, calc_torch); what is not known is kept apart. */
void equipment(std::vector<source> &out, source &hidden)
{
	auto const &a_info = game->edit_data.a_info;
	auto const &set_info = game->edit_data.set_info;
	auto const &r_info = game->edit_data.r_info;
	for (int i = INVEN_WIELD; i < INVEN_TOTAL; i++)
	{
		object_type const *o_ptr = &p_ptr->inventory[i];
		if (!o_ptr->k_ptr) continue;
		bool const known = object_known_p(o_ptr);
		source s { "item" };
		s.item = i;
		object_flags_no_set = true;
		auto const flags = object_flags(o_ptr);
		object_flags_no_set = false;
		s.parts.push_back({ flags, o_ptr->pval });
		if (o_ptr->name1 && a_info[o_ptr->name1].set != -1)
		{
			auto const &set = set_info[a_info[o_ptr->name1].set];
			for (int k = 0; k < set.num; k++)
			{
				if (set.arts[k].a_idx != o_ptr->name1 || !set.arts[k].present) continue;
				for (int j = 0; j < set.num_use; j++) s.parts.push_back({ set.arts[k].flags[j], set.arts[k].pval[j] });
			}
		}
		auto const all = s.flags();
		if (!(all & TR_FUEL_LITE) || o_ptr->timeout > 0) s.nums["light"] += lite_radius(all);
		if (o_ptr->name1 == ART_ANCHOR) s.grants["time"] = "";
		if (all & TR_ANTIMAGIC_50)
		{
			int const mod = o_ptr->to_h + o_ptr->to_d + o_ptr->to_a;
			s.nums["antimagicField"] += std::max(0, 10 + get_skill_scale(SKILL_ANTIMAGIC, 40) - mod);
		}
		if (i == INVEN_CARRY)
		{
			auto const &r = r_info[o_ptr->pval];
			if (r.flags & RF_INVISIBLE) s.nums["invis"] += 20;
			if (r.flags & RF_REFLECTING) s.parts.push_back({ TR_REFLECT });
			if (r.flags & RF_CAN_FLY) s.parts.push_back({ TR_FEATHER });
			if (r.flags & RF_AQUATIC) s.parts.push_back({ TR_WATER_BREATH });
		}
		if (!known)
		{
			for (auto const &pt : s.parts) hidden.parts.push_back(pt);
			for (auto const &[id, n] : s.nums) hidden.nums[id] += n;
			for (auto const &[id, as] : s.grants) hidden.grants[id] = as;
			continue;
		}
		char name[160];
		object_desc(name, o_ptr, true, 0);
		s.name = name;
		out.push_back(std::move(s));
	}
}

/* The corruptions' flags and amounts (calc_corruptions), named from tome2's own list. */
void corruptions(std::vector<source> &out, object_flag_set &given)
{
	std::vector<std::string> names;
	{
		std::istringstream lines(dump_corruptions(false, false));
		std::string line;
		bool heading = true;
		while (std::getline(lines, line))
		{
			if (line.empty())
			{
				heading = true;
				continue;
			}
			if (heading && line.back() == ':') names.push_back(line.substr(0, line.size() - 1));
			heading = false;
		}
	}
	std::size_t at = 0;
	for (int i = 0; i < CORRUPTIONS_MAX; i++)
	{
		if (!p_ptr->corruptions[i]) continue;
		source s { "corruption", at < names.size() ? names[at] : "" };
		at++;
		switch (i)
		{
		case CORRUPT_BALROG_AURA: s.parts.push_back({ TR_SH_FIRE | TR_LITE1 }); break;
		case CORRUPT_BALROG_WINGS: s.parts.push_back({ TR_FLY }); add_stats(s, { 0, 0, 0, -2, 0, -4 }); break;
		case CORRUPT_BALROG_STRENGTH: add_stats(s, { 3, 0, 0, -3, 1, -1 }); break;
		case CORRUPT_DEMON_SPIRIT: add_stats(s, { 0, 1, 0, 0, 0, -2 }); break;
		case CORRUPT_DEMON_HIDE:
			s.nums["speed"] = -(p_ptr->lev / 7);
			if (p_ptr->lev >= 40) s.parts.push_back({ TR_IM_FIRE });
			break;
		case CORRUPT_RANDOM_TELEPORT: s.parts.push_back({ TR_TELEPORT }); break;
		case CORRUPT_ANTI_TELEPORT: if (!p_ptr->corrupt_anti_teleport_stopped) s.grants["time"] = ""; break;
		case CORRUPT_TROLL_BLOOD: s.parts.push_back({ TR_REGEN | TR_AGGRAVATE | ESP_TROLL }); break;
		default: break;
		}
		given |= s.flags();
		if (!s.parts.empty() || !s.nums.empty() || !s.grants.empty()) out.push_back(std::move(s));
	}
}

/* The god's gifts (calc_gods, calc_torch_gods). */
void god(std::vector<source> &out)
{
	if (!p_ptr->pgod) return;
	source s { "god", deity_info[p_ptr->pgod].name };
	auto const grace = p_ptr->grace;
	auto const steps = [grace](int from) { return (grace > from) + (grace > from + 10000) + (grace > from + 20000); };
	switch (p_ptr->pgod)
	{
	case GOD_ERU:
		s.nums["wis"] = steps(10000);
		break;
	case GOD_MELKOR:
		s.parts.push_back({ TR_RES_FIRE });
		add_stats(s, { s16b(steps(10000)), s16b(-steps(10000)), s16b(-steps(10000)), 0, s16b(steps(10000)), s16b(steps(10000)) });
		if (praying_to(GOD_MELKOR))
		{
			if (grace > 5000) s.nums["invis"] = 30;
			if (grace > 15000) s.parts.push_back({ TR_IM_FIRE });
		}
		break;
	case GOD_MANWE:
		if (grace >= 2000) s.parts.push_back({ TR_FEATHER });
		if (praying_to(GOD_MANWE))
		{
			s.nums["speed"] = std::min<s32b>(grace, 35000) / 5000;
			if (grace >= 7000) s.parts.push_back({ TR_FREE_ACT });
			if (grace >= 15000) s.parts.push_back({ TR_FLY });
		}
		break;
	case GOD_TULKAS:
		s.nums["con"] = (grace > 5000) + (grace > 10000) + (grace > 15000);
		s.nums["str"] = (grace > 10000) + (grace > 15000) + (grace > 20000);
		break;
	case GOD_AULE:
		if (grace > 5000) s.parts.push_back({ TR_RES_FIRE });
		break;
	case GOD_VARDA:
		s.nums["light"] = 1;
		break;
	case GOD_MANDOS:
		s.parts.push_back({ TR_RES_NETHER });
		if (p_ptr->praying && grace > 10000) s.grants["time"] = "";
		if (p_ptr->praying && grace > 20000) s.parts.push_back({ TR_IM_NETHER });
		break;
	case GOD_ULMO:
		s.parts.push_back({ TR_WATER_BREATH });
		if (p_ptr->praying && grace > 1000) s.parts.push_back({ TR_RES_POIS });
		if (p_ptr->praying && grace > 15000) s.parts.push_back({ TR_MAGIC_BREATH });
		break;
	default:
		break;
	}
	out.push_back(std::move(s));
}

/* What skills give by themselves (calc_bonuses, calc_schools). */
void skills(std::vector<source> &out)
{
	auto add = [&out](int skill, object_flag_set const &flags) {
		source s { "skill", skill_name(skill) };
		s.parts.push_back({ flags });
		out.push_back(std::move(s));
	};
	if (get_skill(SKILL_DAEMON) > 20) add(SKILL_DAEMON, get_skill(SKILL_DAEMON) > 30 ? TR_RES_CONF | TR_RES_FEAR : TR_RES_CONF);
	if (get_skill(SKILL_MINDCRAFT) >= 40) add(SKILL_MINDCRAFT, ESP_ALL);
	if (get_skill(SKILL_AIR) >= 50) add(SKILL_AIR, TR_MAGIC_BREATH);
	if (get_skill(SKILL_WATER) >= 30) add(SKILL_WATER, TR_WATER_BREATH);
	if (p_ptr->melee_style == SKILL_HAND && !monk_heavy_armor())
	{
		source s { "skill", skill_name(SKILL_HAND) };
		s.nums["speed"] = get_skill_scale(SKILL_HAND, 5);
		if (get_skill(SKILL_HAND) > 24) s.parts.push_back({ TR_FREE_ACT });
		if (!s.parts.empty() || s.nums["speed"]) out.push_back(std::move(s));
	}
	if (get_skill(SKILL_ANTIMAGIC))
	{
		source s { "skill", skill_name(SKILL_ANTIMAGIC) };
		s.nums["antimagicField"] = get_skill(SKILL_ANTIMAGIC);
		if (p_ptr->antimagic_extra & CLASS_ANTIMAGIC)
		{
			s.parts.push_back({ TR_NO_TELE });
			s.grants["time"] = "";
		}
		out.push_back(std::move(s));
	}
}

/* The body the hero has taken (calc_body_bonus), or the form (calc_mimic: its flags are the extra flags not the corruptions'). */
void form(std::vector<source> &out, object_flag_set const &corrupted)
{
	auto const &r_info = game->edit_data.r_info;
	if (p_ptr->mimic_form)
	{
		source s { "form", get_mimic_name(p_ptr->mimic_form) };
		s.mimic = true;
		if (p_ptr->tim_mimic > 0)
		{
			s.effect = "mimic";
			s.turns = p_ptr->tim_mimic;
		}
		s.parts.push_back({ p_ptr->xtra_flags & ~corrupted });
		out.push_back(std::move(s));
		return;
	}
	if (!p_ptr->body_monster) return;
	auto const &r = r_info[p_ptr->body_monster];
	source s { "form", r.name ? r.name : "" };
	s.effect = "body";
	if (p_ptr->disembodied)
	{
		s.parts.push_back({ TR_WRAITH });
		out.push_back(std::move(s));
		return;
	}
	static const std::pair<monster_race_flag_set, object_flag_set> table[] = {
		{ RF_REFLECTING, TR_REFLECT }, { RF_REGENERATE, TR_REGEN }, { RF_AURA_FIRE, TR_SH_FIRE }, { RF_AURA_ELEC, TR_SH_ELEC },
		{ RF_PASS_WALL, TR_WRAITH }, { RF_SUSCEP_FIRE, TR_SENS_FIRE }, { RF_IM_ACID, TR_RES_ACID }, { RF_IM_ELEC, TR_RES_ELEC },
		{ RF_IM_FIRE, TR_RES_FIRE }, { RF_IM_POIS, TR_RES_POIS }, { RF_IM_COLD, TR_RES_COLD }, { RF_RES_NETH, TR_RES_NETHER },
		{ RF_RES_NEXU, TR_RES_NEXUS }, { RF_RES_DISE, TR_RES_DISEN }, { RF_NO_FEAR, TR_RES_FEAR }, { RF_NO_SLEEP, TR_FREE_ACT },
		{ RF_NO_CONF, TR_RES_CONF }, { RF_CAN_FLY, TR_FEATHER }, { RF_AQUATIC, TR_WATER_BREATH }, { RF_NEVER_MOVE, TR_IMMOVABLE },
	};
	object_flag_set flags;
	for (auto const &[rf, tr] : table)
	{
		if (r.flags & rf) flags |= tr;
	}
	s.parts.push_back({ flags });
	s.nums["speed"] = r.speed - 110;
	s.nums["int"] = ((r.flags & RF_SMART) ? 1 : 0) - ((r.flags & RF_STUPID) ? 1 : 0);
	if (r.flags & RF_INVISIBLE) s.nums["invis"] = 20;
	out.push_back(std::move(s));
}

/* The timed effects, by the ids json_effects gives them (calc_bonuses, calc_torch). */
void effects(std::vector<source> &out)
{
	auto add = [&out](char const *id, int turns, object_flag_set const &flags, std::map<std::string, int> nums = {}) {
		if (turns <= 0) return;
		source s { "effect" };
		s.effect = id;
		s.turns = turns;
		s.parts.push_back({ flags });
		s.nums = std::move(nums);
		out.push_back(std::move(s));
	};
	add("resistAcid", p_ptr->oppose_acid, TR_RES_ACID);
	add("resistElec", p_ptr->oppose_elec, TR_RES_ELEC);
	add("resistFire", p_ptr->oppose_fire, TR_RES_FIRE);
	add("resistCold", p_ptr->oppose_cold, TR_RES_COLD);
	add("resistPois", p_ptr->oppose_pois, TR_RES_POIS);
	add("resistChaos", p_ptr->oppose_cc, TR_RES_CHAOS);
	add("hero", p_ptr->hero, TR_RES_FEAR);
	add("shero", p_ptr->shero, TR_RES_FEAR);
	add("holy", p_ptr->holy, TR_HOLD_LIFE, { { "light", 1 }, { "luck", 5 } });
	add("wraith", p_ptr->tim_wraith, p_ptr->disembodied ? object_flag_set(TR_WRAITH) : TR_WRAITH | TR_REFLECT);
	add("reflect", p_ptr->tim_reflect, TR_REFLECT);
	add("levitation", p_ptr->tim_ffall, TR_FEATHER);
	add("flight", p_ptr->tim_fly, TR_FLY);
	add("waterBreath", p_ptr->tim_water_breath, TR_WATER_BREATH);
	add("magicBreath", p_ptr->tim_magic_breath, TR_MAGIC_BREATH);
	add("telepathy", p_ptr->tim_esp, ESP_ALL);
	add("seeInvisible", p_ptr->tim_invis, TR_SEE_INVIS);
	add("precognition", p_ptr->tim_precognition, TR_PRECOGNITION);
	add("regen", p_ptr->tim_regen, TR_REGEN);
	add("infravision", p_ptr->tim_infra, {}, { { "infra", 10 } });
	add("light", p_ptr->tim_lite, {}, { { "light", 2 } });
	add("invisible", p_ptr->tim_invisible, {}, { { "invis", p_ptr->tim_inv_pow } });
	add("fast", p_ptr->fast, {}, { { "speed", p_ptr->speed_factor } });
	add("lightspeed", p_ptr->lightspeed, {}, { { "speed", 50 } });
	add("slow", p_ptr->slow, {}, { { "speed", -10 } });
	if (p_ptr->tim_roots > 0)
	{
		source s { "effect" };
		s.effect = "roots";
		s.turns = p_ptr->tim_roots;
		s.grants["stun"] = "";
		out.push_back(std::move(s));
	}
	if (p_ptr->black_breath)
	{
		source s { "effect" };
		s.effect = "blackBreath";
		s.parts.push_back({ TR_BLACK_BREATH });
		out.push_back(std::move(s));
	}
}

/* What the race, its modifier and the class give by their own flags (race_flags_p): a weakness to light (only in the hero's own body), never stunned or cut, walking through walls, holding off the Black Breath, a bow's extra might. */
void race_flags(source &s, player_race_flag_set const &flags, bool own_body)
{
	if (own_body && (flags & PR_HURT_LITE)) s.grants["lite"] = "vulnerable";
	if (flags & PR_NO_STUN) s.grants["stun"] = "";
	if (flags & PR_NO_CUT) s.grants["cuts"] = "";
	if (flags & PR_SEMI_WRAITH) s.grants["wraith"] = "";
	if (flags & PR_RESIST_BLACK_BREATH) s.grants["blackBreathResist"] = "";
	bool const might = ((flags & PR_XTRA_MIGHT_BOW) && p_ptr->tval_ammo == TV_ARROW) || ((flags & PR_XTRA_MIGHT_SLING) && p_ptr->tval_ammo == TV_SHOT) ||
	                   ((flags & PR_XTRA_MIGHT_XBOW) && p_ptr->tval_ammo == TV_BOLT);
	if (might) s.nums["might"] += 1;
}

/* The shots and might archery skill adds to a launcher the hero can hold steady (calc_bonuses). */
void archery(std::vector<source> &out)
{
	if (!p_ptr->inventory[INVEN_BOW].k_ptr || p_ptr->heavy_shoot) return;
	int const skill = get_archery_skill();
	if (skill == -1) return;
	source s { "skill", skill_name(skill) };
	s.nums["shots"] = get_skill(skill) / 16;
	s.nums["might"] = get_skill(skill) / 25;
	bool const matched = (skill == SKILL_SLING && p_ptr->tval_ammo == TV_SHOT) || (skill == SKILL_BOW && p_ptr->tval_ammo == TV_ARROW) || (skill == SKILL_XBOW && p_ptr->tval_ammo == TV_BOLT);
	if (matched) s.nums["might"] += get_skill(skill) / 30;
	if (s.nums["shots"] || s.nums["might"]) out.push_back(std::move(s));
}

/* Whether gear's extra blows count: tome2 adds them in every way of fighting but one, an empty hand with a weapon's style. */
bool gear_blows = true;

/*
 * The blows of a round (calc_bonuses): with a weapon, Strength and
 * Dexterity against its weight give the base from tome2's table, up to the
 * class's limit (raised by the Extra Max Blow abilities), and gear, the
 * class and weapon mastery add to it; bare-handed, the Barehand combat
 * skill gives them; in bear form, the Bearform combat skill; a body
 * without hands, Strength and Dexterity. What a mimic form adds is left to
 * credit_form, and gear not yet identified to none.
 */
void blows(std::vector<source> &out, source const &hidden)
{
	auto const &r_info = game->edit_data.r_info;
	auto credit = [&out](char const *kind, std::string const &name, int n) {
		if (!n) return;
		auto it = std::find_if(out.begin(), out.end(), [&](source const &s) { return !std::strcmp(s.kind, kind) && s.name == name; });
		if (it == out.end()) it = out.insert(out.end(), source { kind, name });
		it->nums["blows"] += n;
	};
	auto rest = [&out, &hidden] {
		auto const &blows_prop = *std::find_if(props().begin(), props().end(), [](prop const &p) { return !std::strcmp(p.id, "blows"); });
		int n = p_ptr->num_blow - share_of(hidden, blows_prop).n;
		for (auto const &s : out) n -= share_of(s, blows_prop).n;
		return n;
	};
	gear_blows = true;
	object_type const *weapon = &p_ptr->inventory[INVEN_WIELD];
	if (weapon->k_ptr)
	{
		int num = 0, wgt = 0, mul = 0;
		analyze_blow(&num, &wgt, &mul);
		int const div = std::max<int>(wgt, weapon->weight);
		int const str = std::min(11, adj_str_blow[p_ptr->stat_ind[A_STR]] * mul / div);
		int const dex = std::min<int>(11, adj_dex_blow[p_ptr->stat_ind[A_DEX]]);
		credit("stats", "Strength and Dexterity", std::min<int>(blows_table[str][dex], num));
		credit("class", cp_ptr->title, p_ptr->lev * cp_ptr->extra_blows / 50);
		if (int const mastery = get_weaponmastery_skill(); mastery != -1) credit("skill", skill_name(mastery), get_skill_scale(mastery, 2));
		credit("skill", skill_name(SKILL_MASTERY), get_skill_scale(SKILL_MASTERY, 3));
	}
	else if (p_ptr->melee_style == SKILL_HAND)
	{
		credit("skill", skill_name(SKILL_HAND), rest());
	}
	else if (!r_info[p_ptr->body_monster].body_parts[BODY_WEAPON])
	{
		credit("stats", "Strength and Dexterity", rest());
	}
	else if (!p_ptr->body_monster && p_ptr->mimic_form == resolve_mimic_name("Bear") && p_ptr->melee_style == SKILL_BEAR)
	{
		credit("skill", skill_name(SKILL_BEAR), 2 + get_skill(SKILL_BEAR) / 5);
	}
	else
	{
		gear_blows = false;
		credit("stats", "Unarmed", 1);
	}
}

/* The glow of a trait, an aura or anything but a worn light, which lights radius 1 only when nothing else gives light (calc_torch): given to the first that glows. */
void glow(std::vector<source> &out)
{
	if (!p_ptr->lite) return;
	int lit = 0;
	for (auto const &s : out)
	{
		if (!std::strcmp(s.kind, "item") || !std::strcmp(s.kind, "effect"))
		{
			if (auto it = s.nums.find("light"); it != s.nums.end()) lit += it->second;
		}
	}
	if (lit) return;
	for (auto &s : out)
	{
		if (!std::strcmp(s.kind, "item") || !(s.flags() & (TR_LITE1 | TR_LITE2 | TR_LITE3 | TR_SH_FIRE))) continue;
		s.nums["light"] += 1;
		return;
	}
}

/* Every source of the hero's properties, as calc_bonuses applies them. */
std::vector<source> sources(source &hidden)
{
	std::vector<source> out;
	bool const own_body = !p_ptr->mimic_form && !p_ptr->body_monster;
	{
		source s { "race", rp_ptr->title };
		add_stats(s, rp_ptr->ps.adj);
		s.nums["infra"] = rp_ptr->infra * 10;
		if (own_body) add_lflags(s, rp_ptr->lflags);
		race_flags(s, rp_ptr->flags, own_body);
		out.push_back(std::move(s));
	}
	if (rmp_ptr && rmp_ptr->title.find_first_not_of(' ') != std::string::npos)
	{
		source s { "race", rmp_ptr->title };
		add_stats(s, rmp_ptr->ps.adj);
		s.nums["infra"] = rmp_ptr->infra * 10;
		if (own_body) add_lflags(s, rmp_ptr->lflags);
		race_flags(s, rmp_ptr->flags, own_body);
		out.push_back(std::move(s));
	}
	{
		source s { "class", cp_ptr->title };
		add_stats(s, cp_ptr->ps.adj);
		add_lflags(s, cp_ptr->lflags);
		race_flags(s, cp_ptr->flags | spp_ptr->flags, own_body);
		out.push_back(std::move(s));
	}
	skills(out);
	archery(out);
	god(out);
	object_flag_set corrupted;
	corruptions(out, corrupted);
	form(out, corrupted);
	if (p_ptr->astral)
	{
		source s { "fate", "Astral being" };
		s.parts.push_back({ TR_WRAITH });
		out.push_back(std::move(s));
	}
	equipment(out, hidden);
	effects(out);
	glow(out);
	blows(out, hidden);
	{
		source s { "tactic", tactic_info[static_cast<byte>(p_ptr->tactic)].name };
		s.nums["stealth"] = tactic_info[static_cast<byte>(p_ptr->tactic)].to_stealth;
		out.push_back(std::move(s));
	}
	{
		source s { "movement", move_info[static_cast<byte>(p_ptr->movement)].name };
		s.nums["speed"] = move_info[static_cast<byte>(p_ptr->movement)].to_speed;
		s.nums["stealth"] = move_info[static_cast<byte>(p_ptr->movement)].to_stealth;
		out.push_back(std::move(s));
	}
	{
		int const weight = calc_total_weight();
		int const limit = weight_limit();
		if (weight > limit / 2)
		{
			source s { "load", "Heavy load" };
			s.nums["speed"] = -((weight - limit / 2) / (limit / 10));
			out.push_back(std::move(s));
		}
	}
	if (p_ptr->food >= PY_FOOD_MAX)
	{
		source s { "load", "Gorged" };
		s.nums["speed"] = -10;
		out.push_back(std::move(s));
	}
	return out;
}

/* The grade the hero's known sources give an element, as calc_bonuses and the damage functions combine them (used when unknown gear would show through): only the five elements have a timed resistance of their own, and light and a weakness to it cancel out. */
int known_grade(prop const &p, std::vector<std::pair<std::size_t, share>> const &from, std::vector<source> const &all)
{
	static std::set<std::string> const timed = { "acid", "elec", "fire", "cold", "pois" };
	bool immune = false, resist = false, oppose = false, vulnerable = false;
	for (auto const &[i, sh] : from)
	{
		if (!std::strcmp(sh.as, "immune")) immune = true;
		else if (!std::strcmp(sh.as, "vulnerable")) vulnerable = true;
		else if (all[i].turns > 0 && timed.count(p.id)) oppose = true;
		else resist = true;
	}
	if (!std::strcmp(p.id, "lite") && resist && vulnerable) return 0;
	return grade(immune, resist, oppose, vulnerable && !resist && !oppose && !immune);
}

/* What a mimic form adds by itself (calc_mimic sets stats, speed and some abilities directly), credited to the form: what its known sources leave unexplained. */
void credit_form(prop const &p, int now, std::vector<std::pair<std::size_t, share>> &from, std::vector<source> const &all)
{
	auto const form = std::find_if(all.begin(), all.end(), [](source const &s) { return s.mimic; });
	if (form == all.end() || !std::strcmp(p.id, "light")) return;
	std::size_t const at = form - all.begin();
	auto mine = std::find_if(from.begin(), from.end(), [at](auto const &f) { return f.first == at; });
	if (p.kind == prop_kind::number)
	{
		int sum = 0;
		for (auto const &[i, sh] : from) sum += sh.n;
		if (!p.known || now == sum) return;
		if (mine == from.end()) mine = from.insert(std::upper_bound(from.begin(), from.end(), at, [](std::size_t i, auto const &f) { return i < f.first; }), { at, share { true, "", 0 } });
		mine->second.n += now - sum;
	}
	else if (now > 0 && from.empty())
	{
		from.emplace_back(at, share { true, "", 0 });
	}
}

} // namespace <anonymous>

/*
 * The hero's properties for the character sheet's census: `sources`
 * [{kind, name, i (an item's inventory index), effect (json_effects' id),
 * turns}] and `props` [{id, now, from: [{s, as, n}]}]: kind race, class,
 * skill, god, corruption, form, fate, item, effect, tactic, movement,
 * load, stats (Strength and Dexterity's blows); `now` the hero's state (1/0; an element's grade 3 immune,
 * 2 resisted twice, 1, -1 vulnerable; an amount), left out for an amount
 * tome2 keeps nowhere; `as` "immune" or "vulnerable"; `n` what a source
 * adds to an amount. Gear not yet identified shows nothing: what only it
 * gives is left out. With a weapon, `blowsLimit` is the most blows
 * Strength and Dexterity give, and `blowsRaised` the Extra Max Blow
 * abilities that raised it.
 */
extern "C" EMSCRIPTEN_KEEPALIVE char const *web_properties_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();
	source hidden { "hidden" };
	auto const all = sources(hidden);

	w.key("sources").begin_array();
	for (auto const &s : all)
	{
		w.begin_object();
		w.field("kind", s.kind);
		if (!s.name.empty()) w.field("name", s.name);
		if (s.item >= 0) w.field("i", s.item);
		if (s.effect) w.field("effect", s.effect);
		if (s.turns > 0) w.field("turns", s.turns);
		w.end_object();
	}
	w.end_array();

	w.key("props").begin_array();
	for (auto const &p : props())
	{
		std::vector<std::pair<std::size_t, share>> from;
		for (std::size_t i = 0; i < all.size(); i++)
		{
			auto const sh = share_of(all[i], p);
			bool const ignored = !gear_blows && !std::strcmp(p.id, "blows") && !std::strcmp(all[i].kind, "item");
			if (sh.counts && !ignored) from.emplace_back(i, sh);
		}
		auto const unseen = share_of(hidden, p);
		w.begin_object();
		w.field("id", p.id);
		if (p.now)
		{
			int now = p.now();
			if (unseen.counts)
			{
				if (p.kind == prop_kind::number) now -= unseen.n;
				else if (p.kind == prop_kind::grade) now = known_grade(p, from, all);
				else if (from.empty()) now = 0;
			}
			if (p.known) w.field("now", now);
			credit_form(p, now, from, all);
		}
		w.key("from").begin_array();
		for (auto const &[i, sh] : from)
		{
			w.begin_object();
			w.field("s", static_cast<long>(i));
			if (*sh.as) w.field("as", sh.as);
			if (sh.n) w.field("n", sh.n);
			w.end_object();
		}
		w.end_array();
		w.end_object();
	}
	w.end_array();
	if (p_ptr->antimagic) w.field("antimagicRadius", p_ptr->antimagic_dis);
	if (p_ptr->inventory[INVEN_WIELD].k_ptr)
	{
		int num = 0, wgt = 0, mul = 0;
		analyze_blow(&num, &wgt, &mul);
		w.field("blowsLimit", num);
		w.field("blowsRaised", (p_ptr->has_ability(AB_MAX_BLOW1) ? 1 : 0) + (p_ptr->has_ability(AB_MAX_BLOW2) ? 1 : 0));
	}
	w.end_object();
	return json.c_str();
}
