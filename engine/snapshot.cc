/*
 * Game state export for the web renderer.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "ability_type.hpp"
#include "cave.hpp"
#include "cave_type.hpp"
#include "cmd1.hpp"
#include "cmd2.hpp"
#include "cmd5.hpp"
#include "corrupt.hpp"
#include "defines.hpp"
#include "dungeon_info_type.hpp"
#include "feature_flag.hpp"
#include "feature_type.hpp"
#include "game.hpp"
#include "gf_name_type.hpp"
#include "gods.hpp"
#include "hiscore.hpp"
#include "deity_type.hpp"
#include "inventory.hpp"
#include "levels.hpp"
#include "lua_bind.hpp"
#include "messages.hpp"
#include "mimic.hpp"
#include "monster1.hpp"
#include "monster2.hpp"
#include "monster_race.hpp"
#include "monster_race_flag.hpp"
#include "monster_type.hpp"
#include "object1.hpp"
#include "object2.hpp"
#include "object_flag.hpp"
#include "object_flag_meta.hpp"
#include "object_kind.hpp"
#include "object_type.hpp"
#include "options.hpp"
#include "player_class.hpp"
#include "player_race.hpp"
#include "player_race_flag.hpp"
#include "player_race_mod.hpp"
#include "player_spec.hpp"
#include "player_type.hpp"
#include "powers.hpp"
#include "q_rand.hpp"
#include "quest_type.hpp"
#include "range.hpp"
#include "school_book.hpp"
#include "school_type.hpp"
#include "set_type.hpp"
#include "seed.hpp"
#include "skill_descriptor.hpp"
#include "skills.hpp"
#include "skills_defs.hpp"
#include "spells1.hpp"
#include "spells3.hpp"
#include "spell_type.hpp"
#include "spells4.hpp"
#include "spells5.hpp"
#include "spells6.hpp"
#include "stats.hpp"
#include "store_action_type.hpp"
#include "store_flag.hpp"
#include "owner_type.hpp"
#include "bldg.hpp"
#include "store_info_type.hpp"
#include "store_type.hpp"
#include "tables.hpp"
#include "timer_type.hpp"
#include "town_type.hpp"
#include "tval_desc.hpp"
#include "util.hpp"
#include "variable.hpp"
#include "wilderness_map.hpp"
#include "wilderness_type_info.hpp"
#include "xtra1.hpp"
#include "z-term.hpp"

#include "json.hpp"

#include <boost/preprocessor/cat.hpp>

#include <emscripten.h>
#include <fmt/format.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <functional>
#include <string>
#include <vector>

/* Off-screen terminal (engine/main-web.cc). */
void web_scratch_term_begin();
void web_scratch_term_end();

/* tome2's damage lines for examining a weapon or missile (object1.cc, not in its headers). */
void display_weapon_damage(object_type *o_ptr);
void display_ammo_damage(object_type *o_ptr);

/* Map memory (engine/memory.cc), run options (engine/runoptions.cc) and Adventure mode (engine/adventure.cc). */
void web_memory_tick();
int level_quest();
bool level_quest_open();
void web_run_options_tick();
void web_adventure_tick();
void json_adventure(JsonWriter &w);

/* Shared with the other exports (engine/knowledge.cc). */
/*
 * True once the character has a level, including while a new level is being
 * generated: quest hooks print messages (with -more-) before the engine marks
 * the dungeon ready, and the map must stay native through them.
 */
bool level_ready()
{
	return character_generated && cave && p_ptr;
}

/* The export buffer each JSON export writes and returns. */
std::string json;

/* Clears the export buffer and returns a writer for it. */
JsonWriter start_json()
{
	json.clear();
	return JsonWriter(json);
}

/* Opens an object with "ready": 1 when a level is ready; else writes {"ready":0} and returns false. */
bool begin_ready(JsonWriter &w)
{
	bool const ready = level_ready();
	w.begin_object();
	w.field("ready", ready ? 1 : 0);
	if (!ready) w.end_object();
	return ready;
}

namespace {

/* Header layout shared with web/src/snapshot.ts (int32 slots). */
enum HeaderSlot {
	H_VERSION,
	H_IN_DUNGEON,
	H_ICKY,
	H_WIDTH,
	H_HEIGHT,
	H_PY,
	H_PX,
	H_LIGHT_RADIUS,
	H_DEPTH,
	H_WILD_MODE,
	H_BLIND,
	H_HALLUCINATING,
	H_PANEL_ROW,
	H_PANEL_COL,
	H_ROW_MAP,
	H_COL_MAP,
	H_PTR_FEAT,
	H_PTR_INFO,
	H_PTR_GLYPH,
	H_PTR_ATTR,
	H_PTR_LAYER,
	H_PTR_EFFECT,
	H_AT_COMMAND,
	H_TURN,
	H_FLOOR_OBJECTS,
	H_HERO_ACTING,
	H_COUNT
};

constexpr int32_t SNAPSHOT_VERSION = 3;

enum Layer : uint8_t {
	LAYER_UNKNOWN = 0,
	LAYER_TERRAIN = 1,
	LAYER_OBJECT = 2,
	LAYER_MONSTER = 3,
	LAYER_PLAYER = 4,
	LAYER_MULTI_HUED = 0x80
};

constexpr uint8_t NO_EFFECT = 0xff;

enum FeatureBits : uint32_t {
	FB_NO_WALK = 1 << 0,
	FB_NO_VISION = 1 << 1,
	FB_FLOOR = 1 << 2,
	FB_WALL = 1 << 3,
	FB_PERMANENT = 1 << 4,
	FB_DOOR = 1 << 5,
	FB_ATTR_MULTI = 1 << 6,
	FB_REMEMBER = 1 << 7
};

/* -1 leaves tome2's auto_more option alone; 0 or 1 overrides it on every snapshot. */
int auto_more_override = -1;
/* -1 leaves tome2's delay_factor alone; 0..9 overrides it on every snapshot. */
int delay_override = -1;

int32_t header[H_COUNT];
std::vector<uint8_t> feat_buf(MAX_HGT * MAX_WID);
std::vector<uint16_t> info_buf(MAX_HGT * MAX_WID);
std::vector<uint8_t> glyph_buf(MAX_HGT * MAX_WID);
std::vector<uint8_t> attr_buf(MAX_HGT * MAX_WID);
std::vector<uint8_t> layer_buf(MAX_HGT * MAX_WID);
std::vector<uint8_t> effect_buf(MAX_HGT * MAX_WID);
int32_t ptr(void const *p)
{
	return static_cast<int32_t>(reinterpret_cast<uintptr_t>(p));
}

/* A quest's state for the frontend: active, done or failed, or null while not taken. */
static char const *quest_state(s16b status)
{
	switch (status)
	{
	case QUEST_STATUS_TAKEN: return "active";
	case QUEST_STATUS_COMPLETED:
	case QUEST_STATUS_REWARDED:
	case QUEST_STATUS_FINISHED: return "done";
	case QUEST_STATUS_FAILED:
	case QUEST_STATUS_FAILED_DONE: return "failed";
	default: return nullptr;
	}
}

/* A quest's description as tome2's quest log tells it, in lines, without the headings it colours ("#####y…"). */
static std::vector<std::string> quest_lines(quest_type const &qt)
{
	std::string text = qt.gen_desc ? qt.gen_desc() : std::string();
	if (text.empty())
	{
		for (int i = 0; i < 10 && qt.desc[i][0]; i++) text += std::string(qt.desc[i]) + '\n';
	}
	std::vector<std::string> lines;
	std::size_t start = 0;
	while (start < text.size())
	{
		auto end = text.find('\n', start);
		if (end == std::string::npos) end = text.size();
		auto line = text.substr(start, end - start);
		while (!line.empty() && line.back() == ' ') line.pop_back();
		if (!line.empty() && line.rfind("#####", 0) != 0) lines.push_back(line);
		start = end + 1;
	}
	return lines;
}

/* The fields of the random quest of a depth, inside an object the caller opens and closes: its kind, the creature to defeat, how many, and how many are slain. */
static void json_random_quest(JsonWriter &w, int depth)
{
	auto const &rq = random_quests[depth];
	auto const &r_info = game->edit_data.r_info;
	bool const sword = is_randhero(depth);
	bool const here = depth == dun_level && level_quest() == QUEST_RANDOM;
	w.field("id", QUEST_RANDOM);
	w.field("state", rq.done ? "done" : "active");
	w.field("title", sword ? "Lost sword!" : "Captured princess!");
	w.key("random").begin_object();
	w.field("kind", sword ? "sword" : "princess");
	w.field("foe", rq.r_idx > 0 && static_cast<std::size_t>(rq.r_idx) < r_info.size() && r_info[rq.r_idx].name ? r_info[rq.r_idx].name : "");
	w.field("count", rq.type);
	w.field("slain", rq.done ? rq.type : here ? quest[QUEST_RANDOM].data[0] : 0);
	w.end_object();
}

/*
 * Every fixed quest the hero has taken, done or failed, with its state (random
 * quests are told by the level's own quest): for the game state, so the end
 * of a quest is seen wherever it comes (on its level, as the hero leaves it,
 * or away from any quest's level); with `log`, also its danger level, its
 * description and whether its reward is still to be claimed (tome2's
 * "Completed - Unrewarded"), for the quest log.
 */
static void json_quests(JsonWriter &w, bool log)
{
	w.key("quests").begin_array();
	for (int q = QUEST_NULL + 1; q < MAX_Q_IDX; q++)
	{
		auto const &qt = quest[q];
		if (q == QUEST_RANDOM || qt.silent) continue;
		auto const state = quest_state(qt.status);
		if (!state) continue;
		w.begin_object();
		w.field("id", q);
		w.field("state", state);
		w.field("title", qt.name);
		if (log)
		{
			w.field("level", qt.level);
			w.field("unclaimed", qt.status == QUEST_STATUS_COMPLETED ? 1 : 0);
			w.key("lines").begin_array();
			for (auto const &line : quest_lines(qt)) w.value(line);
			w.end_array();
		}
		w.end_object();
	}
	w.end_array();
}

/*
 * The quest of the level the hero is on (memory.cc level_quest), and whether
 * it is active, done or failed: for a random quest its kind, the creature to
 * defeat, how many, and how many are slain; for the others their name and
 * description as tome2's quest log tells it, and whether the level is the
 * quest's own (reached through a quest entrance, in no dungeon).
 */
void json_level_quest(JsonWriter &w)
{
	int const q = level_quest();
	if (!q) return;
	if (q == QUEST_RANDOM)
	{
		w.key("quest").begin_object();
		json_random_quest(w, dun_level);
		w.end_object();
		return;
	}

	auto const &qt = quest[q];
	if (qt.silent) return;
	auto const state = quest_state(qt.status);
	if (!state) return;
	w.key("quest").begin_object();
	w.field("id", q);
	w.field("own", q == p_ptr->inside_quest ? 1 : 0);
	w.field("state", state);
	w.field("title", qt.name);
	w.key("lines").begin_array();
	for (auto const &line : quest_lines(qt)) w.value(line);
	w.end_array();
	w.end_object();
}

/* What one of an item is called, without article, count or what changes as it is used (charges, bonuses, inscription). */
std::string base_name(object_type const *o_ptr)
{
	object_type one;
	object_copy(&one, const_cast<object_type *>(o_ptr));
	one.number = 1;
	char name[160];
	object_desc(name, &one, false, 0);
	return name;
}

/* How a known item activates (tome2's `A`): 1 while worn, 2 from the pack too (ACTIVATE_NO_WIELD); 0 when it does not, or is not known to. */
int activates(object_type const *o_ptr, object_flag_set const &flags)
{
	if (!(flags & TR_ACTIVATE) || !object_known_p(o_ptr)) return 0;
	return (flags & TR_ACTIVATE_NO_WIELD) ? 2 : 1;
}

/* An item's fields, inside an object the caller opens and closes. */
void json_object_fields(JsonWriter &w, int index, object_type const *o_ptr)
{
	char name[160];
	object_desc(name, o_ptr, true, 3);
	auto const flags = object_flags(o_ptr);

	w.field("i", index);
	w.field("name", name);
	w.field("tval", o_ptr->tval);
	w.field("sval", o_ptr->sval);
	w.field("number", o_ptr->number);
	w.field("weight", o_ptr->weight);
	w.field("ch", static_cast<unsigned char>(object_char(o_ptr)));
	w.field("attr", object_attr(o_ptr));
	w.field("base", base_name(o_ptr));
	w.field("wear", wield_slot(o_ptr) >= 0 ? 1 : 0);
	w.field("activate", activates(o_ptr, flags));
	if (flags & TR_FUEL_LITE) w.field("fuel", o_ptr->timeout);
	w.field("ins", o_ptr->inscription);
}

void json_object(JsonWriter &w, int index, object_type const *o_ptr)
{
	w.begin_object();
	json_object_fields(w, index, o_ptr);
	w.end_object();
}

/* text_out() hook collecting coloured runs (attr, text). */
std::vector<std::pair<byte, std::string>> text_runs;

void text_out_to_json(byte a, const char *str)
{
	text_runs.emplace_back(a, str);
}

void cell_glyph(int y, int x, uint8_t *glyph, uint8_t *attr, uint8_t *layer, uint8_t *effect)
{
	auto const &f_info = game->edit_data.f_info;
	auto const &st_info = game->edit_data.st_info;
	auto const &r_info = game->edit_data.r_info;

	cave_type const *c_ptr = &cave[y][x];

	char c = ' ';
	byte a = TERM_DARK;
	uint8_t l = LAYER_UNKNOWN;

	*effect = NO_EFFECT;

	if (c_ptr->info & (CAVE_MARK | CAVE_SEEN))
	{
		auto const feat = c_ptr->mimic ? c_ptr->mimic : f_info[c_ptr->feat].mimic;
		auto const *f_ptr = &f_info[feat];

		if (feat == FEAT_SHOP)
		{
			c = st_info[c_ptr->special].x_char;
			a = st_info[c_ptr->special].x_attr;
		}
		else
		{
			c = f_ptr->x_char;
			a = f_ptr->x_attr;
		}

		if (c_ptr->special && ((feat == FEAT_MORE) || (feat == FEAT_LESS)))
		{
			a = TERM_VIOLET;
		}

		if (f_ptr->flags & FF_ATTR_MULTI)
		{
			l |= LAYER_MULTI_HUED;
		}

		if (auto effect_idx = c_ptr->maybe_effect)
		{
			*effect = spell_color(game->lasting_effects[*effect_idx].type);
		}

		l = (l & LAYER_MULTI_HUED) | LAYER_TERRAIN;
	}

	for (auto const o_idx : c_ptr->o_idxs)
	{
		object_type const *o_ptr = &o_list[o_idx];

		if (o_ptr->marked)
		{
			c = object_char(o_ptr);
			a = object_attr(o_ptr);
			l = LAYER_OBJECT;
			if (o_ptr->k_ptr && (o_ptr->k_ptr->flags & TR_ATTR_MULTI)) l |= LAYER_MULTI_HUED;
			break;
		}
	}

	if (c_ptr->m_idx)
	{
		monster_type const *m_ptr = &m_list[c_ptr->m_idx];
		auto r_ptr = m_ptr->race();

		if (r_ptr->flags & RF_MIMIC)
		{
			object_type const *o_ptr = &o_list[m_ptr->mimic_o_idx()];

			if (o_ptr->marked)
			{
				c = object_char(o_ptr);
				a = object_attr(o_ptr);
				l = LAYER_OBJECT;
			}
		}
		else if (m_ptr->ml)
		{
			if (!(r_ptr->flags & RF_CHAR_CLEAR)) c = r_ptr->x_char;
			if (!(r_ptr->flags & RF_ATTR_CLEAR)) a = r_ptr->x_attr;
			l = LAYER_MONSTER;
			if (r_ptr->flags & RF_ATTR_MULTI) l |= LAYER_MULTI_HUED;
		}
	}

	if ((y == p_ptr->py) && (x == p_ptr->px) && (!p_ptr->invis || p_ptr->see_inv))
	{
		auto const *r_ptr = &r_info[p_ptr->body_monster];
		c = r_ptr->x_char;
		a = r_ptr->x_attr;
		l = LAYER_PLAYER;
		if (r_ptr->flags & RF_ATTR_MULTI) l |= LAYER_MULTI_HUED;
	}

	*glyph = static_cast<uint8_t>(c);
	*attr = a;
	*layer = l;
}

/* Edit-file names of the player race flags, by bit. */
std::vector<std::pair<player_race_flag_set, char const *>> const &race_flag_names()
{
	static std::vector<std::pair<player_race_flag_set, char const *>> names {
#define PR(tier, index, name) { BOOST_PP_CAT(PR_, name), #name },
#include "player_race_flag_list.hpp"
#undef PR
	};
	return names;
}

void json_race_flags(JsonWriter &w, player_race_flag_set const &flags)
{
	w.key("flags").begin_array();
	for (auto const &[flag, name] : race_flag_names())
	{
		if (flags & flag) w.value(name);
	}
	w.end_array();
}

char modifier_op(char m)
{
	switch (m)
	{
	case MEGO_SUB: return '-';
	case MEGO_FIX: return '=';
	case MEGO_PRC: return '%';
	default: return '+';
	}
}

void json_skill_mods(JsonWriter &w, skill_modifiers const &mods)
{
	auto const &s_descriptors = game->edit_data.s_descriptors;
	w.key("skills").begin_array();
	for (std::size_t i = 0; i < mods.modifiers.size() && i < s_descriptors.size(); i++)
	{
		auto const &m = mods.modifiers[i];
		if ((m.base == 0 && m.mod == 0) || s_descriptors[i].name.empty()) continue;
		w.begin_object();
		w.field("name", s_descriptors[i].name);
		w.field("op", std::string(1, modifier_op(m.basem)));
		w.field("base", static_cast<long>(m.base));
		w.field("modOp", std::string(1, modifier_op(m.modm)));
		w.field("mod", m.mod);
		w.end_object();
	}
	w.end_array();
}

void json_abilities(JsonWriter &w, std::vector<player_race_ability_type> const &abilities)
{
	auto const &ab_info = game->edit_data.ab_info;
	w.key("abilities").begin_array();
	for (auto const &a : abilities)
	{
		if (a.ability < 0 || static_cast<std::size_t>(a.ability) >= ab_info.size()) continue;
		w.begin_object();
		w.field("name", ab_info[a.ability].name);
		w.field("desc", ab_info[a.ability].desc);
		w.field("level", a.level);
		w.end_object();
	}
	w.end_array();
}

void json_level_flags(JsonWriter &w, std::array<player_level_flag, PY_MAX_LEVEL + 1> const &lflags)
{
	w.key("levelFlags").begin_array();
	for (int lev = 0; lev <= PY_MAX_LEVEL; lev++)
	{
		auto const &lf = lflags[lev];
		if (!lf.oflags) continue;
		w.begin_object();
		w.field("level", lev);
		w.field("pval", lf.pval);
		w.key("flags").begin_array();
		for (auto const meta : object_flags_meta())
		{
			if (lf.oflags & meta->flag_set) w.value(meta->e_name);
		}
		w.end_array();
		w.end_object();
	}
	w.end_array();
}

void json_shared(JsonWriter &w, player_shared const &ps)
{
	w.key("stats").begin_array();
	for (int i = 0; i < 6; i++) w.value(ps.adj[i]);
	w.end_array();
	w.field("hitDie", ps.mhp);
	w.field("exp", ps.exp);
	w.key("powers").begin_array();
	for (auto const p : ps.powers)
	{
		auto it = game->powers.find(p);
		if (it == game->powers.end()) continue;
		w.begin_object();
		w.field("name", it->second->name);
		w.field("desc", it->second->desc_text);
		w.end_object();
	}
	w.end_array();
}

void json_bit_names(JsonWriter &w, char const *key, std::array<u32b, 2> const &bits, std::function<std::string(std::size_t)> name, std::size_t count)
{
	w.key(key).begin_array();
	for (std::size_t i = 0; i < count && i < 64; i++)
	{
		if (bits[i / 32] & (1u << (i % 32))) w.value(name(i));
	}
	w.end_array();
}

/* A spell's schools, as tome2 lists them ("Mana/Fire"). */
std::string spell_schools(spell_type *spell)
{
	std::string out;
	for (s32b school_idx : spell_type_get_schools(spell))
	{
		if (!out.empty()) out += '/';
		out += school_at(school_idx)->name;
	}
	return out;
}

/* tome2's store number of the home (store.cc's cur_store_num 7). */
constexpr int HOME_STORE = 7;

/* The shop (or home) on the player's grid, as do_cmd_store finds it; null elsewhere. */
store_type *store_here(int *which = nullptr)
{
	if (!(level_ready() && town_info) || p_ptr->wild_mode) return nullptr;
	auto const &c_ptr = cave[p_ptr->py][p_ptr->px];
	if (c_ptr.feat != FEAT_SHOP) return nullptr;
	auto &stores = town_info[p_ptr->town_num].store;
	if (c_ptr.special < 0 || static_cast<std::size_t>(c_ptr.special) >= stores.size()) return nullptr;
	if (which) *which = c_ptr.special;
	return &stores[c_ptr.special];
}

/* store.cc's store names, which decide what each kind of shop buys. */
bool blessed(object_type const *o_ptr)
{
	return bool(object_flags_known(o_ptr) & TR_BLESSED);
}

bool random_book_of(object_type const *o_ptr, s16b skill)
{
	return o_ptr->tval == TV_BOOK && o_ptr->sval == BOOK_RANDOM && spell_type_random_type(spell_at(o_ptr->pval)) == skill;
}

/*
 * Whether a shop of this name buys anything at all, and whether it buys this
 * object: store.cc's store_will_buy (static there), by the same rules. The
 * home and museums take anything; shops not named below buy nothing.
 */
bool shop_buys(std::string const &name, object_type const *o_ptr)
{
	auto const tval = o_ptr->tval;
	auto any = [tval](std::initializer_list<int> tvals) {
		return std::find(tvals.begin(), tvals.end(), tval) != tvals.end();
	};
	if (name == "General Store")
		return any({ TV_CORPSE, TV_FOOD, TV_LITE, TV_FLASK, TV_SPIKE, TV_SHOT, TV_ARROW, TV_BOLT, TV_DIGGING, TV_CLOAK, TV_BOTTLE });
	if (name == "Armoury")
		return any({ TV_BOOTS, TV_GLOVES, TV_CROWN, TV_HELM, TV_SHIELD, TV_CLOAK, TV_SOFT_ARMOR, TV_HARD_ARMOR, TV_DRAG_ARMOR });
	if (name == "Weaponsmith")
		return any({ TV_SHOT, TV_BOLT, TV_ARROW, TV_BOOMERANG, TV_BOW, TV_DIGGING, TV_HAFTED, TV_POLEARM, TV_SWORD, TV_AXE, TV_MSTAFF });
	if (name == "Temple")
		return any({ TV_DRUID_BOOK, TV_SCROLL, TV_POTION2, TV_POTION, TV_HAFTED }) || random_book_of(o_ptr, SKILL_SPIRITUALITY) ||
			(any({ TV_POLEARM, TV_SWORD, TV_AXE, TV_BOOMERANG }) && blessed(o_ptr));
	if (name == "Alchemy shop")
		return any({ TV_SCROLL, TV_POTION2, TV_POTION, TV_BOTTLE });
	if (name == "Magic shop")
		return any({ TV_SYMBIOTIC_BOOK, TV_AMULET, TV_RING, TV_STAFF, TV_WAND, TV_ROD, TV_ROD_MAIN, TV_SCROLL, TV_POTION2, TV_POTION, TV_MSTAFF, TV_RANDART }) ||
			random_book_of(o_ptr, SKILL_MAGIC) || (tval == TV_BOOK && o_ptr->sval != BOOK_RANDOM);
	if (name == "Black Market") return true;
	if (name == "Book Store") return any({ TV_BOOK, TV_SYMBIOTIC_BOOK, TV_MUSIC_BOOK, TV_DAEMON_BOOK, TV_DRUID_BOOK });
	if (name == "Pet Shop") return tval == TV_EGG;
	if (name == "Hunting Supply Store") return any({ TV_BOOMERANG, TV_SHOT, TV_BOLT, TV_ARROW, TV_BOW, TV_POTION2 });
	if (name == "Construction Supply Store") return any({ TV_LITE, TV_DIGGING });
	if (name == "Music Store") return tval == TV_INSTRUMENT;
	return false;
}

/* The names store.cc gives the shops it buys for. */
bool shop_buys_anything(std::string const &name)
{
	static char const *const names[] = {
		"General Store", "Armoury", "Weaponsmith", "Temple", "Alchemy shop", "Magic shop", "Black Market",
		"Book Store", "Pet Shop", "Hunting Supply Store", "Construction Supply Store", "Music Store",
	};
	return std::find(std::begin(names), std::end(names), name) != std::end(names);
}

/*
 * The price of one of an object, as store.cc's price_item (static there):
 * `selling` is the shop selling to the player, otherwise the shop buying.
 * Buying, a Black Market keeper's greed and a race they hate (or charisma of
 * 5 or less) make it negative, and tome2 would take that gold for the sale.
 */
long shop_price(store_type const &st, owner_type const &owner, object_type const *o_ptr, bool selling)
{
	auto const &st_info = game->edit_data.st_info;
	long price = object_value(o_ptr);
	if (price <= 0) return 0;
	int factor = is_state(&st, STORE_LIKED) ? owner.costs[STORE_LIKED] : is_state(&st, STORE_HATED) ? owner.costs[STORE_HATED] : owner.costs[STORE_NORMAL];
	factor += adj_chr_gold[p_ptr->stat_ind[A_CHR]];
	bool const black_market = bool(st_info[st.st_idx].flags & STF_ALL_ITEM);
	int const greed = owner.inflation;
	int adjust;
	if (!selling)
	{
		if (o_ptr->tval == TV_SHOT || o_ptr->tval == TV_ARROW || o_ptr->tval == TV_BOLT) price /= 5;
		adjust = std::min(100, 100 + (300 - (greed + factor)));
		if (black_market) price /= 2;
		if (options->no_selling) price = 0;
	}
	else
	{
		adjust = std::max(100, 100 + ((greed + factor) - 300));
		if (black_market) price *= 2;
		if (price <= 0) price = 1;
	}
	return (price * adjust + 50) / 100;
}

/* One of a stack, with a wand's charges shared out as store.cc does. */
object_type one_of(object_type const *o_ptr)
{
	object_type one;
	object_copy(&one, const_cast<object_type *>(o_ptr));
	one.number = 1;
	if (o_ptr->tval == TV_WAND && o_ptr->number > 0) one.pval = o_ptr->pval / o_ptr->number;
	return one;
}

/* As store.cc's store_object_similar (static there): whether a shop stacks an object onto one it has. */
static bool shop_stacks(object_type const *o_ptr, object_type const *j_ptr)
{
	if (o_ptr == j_ptr || o_ptr->k_ptr != j_ptr->k_ptr) return false;
	if (o_ptr->pval != j_ptr->pval && o_ptr->tval != TV_WAND) return false;
	if (o_ptr->pval2 != j_ptr->pval2 || o_ptr->pval3 != j_ptr->pval3) return false;
	if (o_ptr->to_h != j_ptr->to_h || o_ptr->to_d != j_ptr->to_d || o_ptr->to_a != j_ptr->to_a) return false;
	if (o_ptr->name1 != j_ptr->name1 || o_ptr->name2 != j_ptr->name2 || o_ptr->name2b != j_ptr->name2b) return false;
	if (!o_ptr->artifact_name.empty() || !j_ptr->artifact_name.empty()) return false;
	if (o_ptr->art_flags != j_ptr->art_flags) return false;
	if (o_ptr->xtra1 || j_ptr->xtra1) return false;
	if (o_ptr->tval == TV_LITE ? o_ptr->timeout != j_ptr->timeout : (o_ptr->timeout || j_ptr->timeout)) return false;
	if (o_ptr->ac != j_ptr->ac || o_ptr->dd != j_ptr->dd || o_ptr->ds != j_ptr->ds) return false;
	return o_ptr->discount == j_ptr->discount;
}

/* As store.cc's store_check_num (static there): whether the shop, home or museum has room for an object, free or on a stack it joins. */
static bool shop_has_room(store_type const &st, bool home_like, object_type const *o_ptr)
{
	if (st.stock.size() < st.stock_size) return true;
	return std::any_of(st.stock.begin(), st.stock.end(), [&](object_type const &o_ref) {
		return home_like ? object_similar(&o_ref, o_ptr) : shop_stacks(&o_ref, o_ptr);
	});
}

/*
 * tome2's device ("stick") mode, off while spells are read for the hero and
 * put back after: tome2 may be inside a wand's or staff's spell (asking where
 * to aim it) while the hero looks at something, and its mode is not
 * reentrant (set_stick_mode asserts, in debug builds only).
 */
struct stick_mode_kept
{
	s32b const use = get_level_use_stick;
	s32b const max = get_level_max_stick;
	stick_mode_kept()
	{
		get_level_use_stick = -1;
		get_level_max_stick = -1;
	}
	~stick_mode_kept()
	{
		get_level_use_stick = use;
		get_level_max_stick = max;
	}
};

/* set_stick_mode for a wand or staff, inside a stick_mode_kept (whose mode is put back after). */
struct stick_mode_of
{
	explicit stick_mode_of(object_type const *o_ptr)
	{
		get_level_use_stick = o_ptr->pval3 & 0xFFFF;
		get_level_max_stick = o_ptr->pval3 >> 16;
	}
	~stick_mode_of()
	{
		get_level_use_stick = -1;
		get_level_max_stick = -1;
	}
};

/* A spell's description lines (tome2's print_spell_desc), joined. */
std::string spell_description(spell_type *spell)
{
	std::string desc;
	spell_type_description_foreach(spell, [&](std::string const &line) {
		if (!desc.empty()) desc += '\n';
		desc += line;
	});
	return desc;
}

/* The god a spell is prayed to (its school's deity), or null for other spells. */
deity_type const *spell_god(spell_type *spell)
{
	for (s32b school_idx : spell_type_get_schools(spell))
	{
		int const god = school_at(school_idx)->deity_idx;
		if (god > 0 && god < MAX_GODS) return &deity_info[god];
	}
	return nullptr;
}

/* The god an altar is raised to (tome2's FEAT_ALTAR_HEAD + god - 1), or null for other terrain and gods of other modules. */
deity_type const *altar_god(int feat)
{
	if (feat < FEAT_ALTAR_HEAD || feat > FEAT_ALTAR_TAIL) return nullptr;
	int const god = feat - FEAT_ALTAR_HEAD + 1;
	if (god >= MAX_GODS || !god_enabled(&deity_info[god])) return nullptr;
	return &deity_info[god];
}

/* What tome2's spell list and its description say of a spell (print_spell, print_spell_desc), common to books and devices. */
void json_spell_common(JsonWriter &w, spell_type *spell)
{
	w.field("name", spell_type_name(spell));
	w.field("school", spell_schools(spell));
	w.field("info", spell_type_info(spell));
	w.field("desc", spell_description(spell));
	w.field("skill", spell_type_skill_level(spell));
	w.field("blind", spell_type_castable_while_blind(spell) ? 1 : 0);
	w.field("confused", spell_type_castable_while_confused(spell) ? 1 : 0);
	if (auto const *god = spell_god(spell)) w.field("god", god->name);
}

/*
 * A school spell of a book whose pval is `pval`, as tome2's spell list shows
 * it for the hero (print_spell): level (-1 when they cannot cast it at all),
 * mana, failure, info; with what a book's browsing tells besides (piety,
 * casting while blind or confused), the skill level it needs, the casting
 * stat, its mana from the first spell level to the 50th, and for music the
 * instrument's power it needs.
 */
void json_spell(JsonWriter &w, s32b spell_idx, s32b pval)
{
	spell_type *spell = spell_at(spell_idx);
	s32b level;
	bool na;
	get_level_school(spell, 50, -50, &level, &na);
	range_type mana;
	spell_type_mana_range(spell, &mana);
	bool const ok = is_ok_spell(spell_idx, pval);
	w.begin_object();
	json_spell_common(w, spell);
	w.field("level", na ? -1 : level);
	w.field("mana", get_mana(spell_idx));
	w.field("fail", spell_chance_book(spell_idx));
	w.field("ok", ok ? 1 : 0);
	w.field("short", ok && get_mana(spell_idx) > get_power(spell_idx) ? 1 : 0);
	w.field("stat", spell_type_casting_stat(spell));
	w.field("manaMin", mana.min);
	w.field("manaMax", mana.max);
	w.field("piety", spell_type_uses_piety_to_cast(spell) ? 1 : 0);
	w.field("instrument", spell_type_minimum_pval(spell) > pval ? spell_type_minimum_pval(spell) : 0);
	w.end_object();
}

/* The spells an item holds, as tome2's browsing lists them (do_cmd_browse_aux): a book's or instrument's, or the one a spell-holding item stores; false for others. */
bool spell_book_of(object_type const *o_ptr, int *sval, s32b *pval)
{
	bool const book = o_ptr->tval == TV_BOOK || o_ptr->tval == TV_DAEMON_BOOK || o_ptr->tval == TV_INSTRUMENT;
	if (book)
	{
		*sval = o_ptr->sval;
		*pval = o_ptr->pval;
		return true;
	}
	if ((object_flags(o_ptr) & TR_SPELL_CONTAIN) && o_ptr->pval2 != -1)
	{
		*sval = BOOK_RANDOM;
		*pval = o_ptr->pval2;
		return true;
	}
	return false;
}

/* Text tome2 writes with text_out while `write` runs, as coloured runs. */
std::vector<std::pair<byte, std::string>> text_out_runs(std::function<void()> const &write)
{
	auto const previous_hook = text_out_hook;
	text_runs.clear();
	web_scratch_term_begin();
	text_out_hook = text_out_to_json;
	write();
	text_out_hook = previous_hook;
	web_scratch_term_end();
	auto runs = std::move(text_runs);
	text_runs.clear();
	return runs;
}

void json_runs(JsonWriter &w, char const *key, std::vector<std::pair<byte, std::string>> const &runs)
{
	w.key(key).begin_array();
	for (auto const &[attr, text] : runs)
	{
		w.begin_array();
		w.value(attr);
		w.value(text);
		w.end_array();
	}
	w.end_array();
}

/*
 * The damage tome2's display_weapon_damage or display_ammo_damage tells
 * (light green figures, each followed by " against" whom), as
 * {blows, rows: [{against, damage}]}; with `blows` the first figure is the
 * number of blows.
 */
void json_damage(JsonWriter &w, char const *key, std::vector<std::pair<byte, std::string>> const &runs, bool blows)
{
	std::vector<std::string> figures;
	std::vector<std::string> against;
	for (auto const &[attr, text] : runs)
	{
		if ((attr == TERM_L_GREEN || attr == TERM_L_RED) && !text.empty() && std::isdigit(static_cast<unsigned char>(text[0])))
		{
			figures.push_back(text.substr(0, text.find(' ')));
		}
		else if (text.rfind(" against ", 0) == 0)
		{
			against.push_back(text.substr(9));
		}
	}
	std::size_t first = 0;
	w.key(key).begin_object();
	if (blows && !figures.empty())
	{
		w.field("blows", std::atol(figures[0].c_str()));
		first = 1;
	}
	w.key("rows").begin_array();
	for (std::size_t i = 0; i < against.size() && first + i < figures.size(); i++)
	{
		w.begin_object();
		w.field("against", against[i]);
		w.field("damage", figures[first + i]);
		w.end_object();
	}
	w.end_array();
	w.end_object();
}

/* Where an item was found (object_out_desc_where_found). */
std::string found_where(s16b level, s16b dungeon)
{
	auto const &d_info = game->edit_data.d_info;
	auto const &wf_info = game->edit_data.wf_info;
	if (dungeon != DUNGEON_WILDERNESS) return fmt::format("on level {} of {}", level, d_info[dungeon].name);
	if (level == 0) return "in the wilderness or in a town";
	if (wf_info[level].terrain_idx == TERRAIN_TOWN) return fmt::format("in the town of {}", wf_info[level].name);
	return fmt::format("in {}", wf_info[level].text);
}

/* How the hero came by an item, as object_out_desc tells it; empty when it does not say. */
std::string found_text(object_type const *o_ptr)
{
	auto const &st_info = game->edit_data.st_info;
	switch (o_ptr->found)
	{
	case OBJ_FOUND_MONSTER:
	{
		char m_name[80];
		monster_race_desc(m_name, o_ptr->found_aux1, o_ptr->found_aux2);
		return fmt::format("You found it in the remains of {} {}.", m_name, found_where(o_ptr->found_aux4, o_ptr->found_aux3));
	}
	case OBJ_FOUND_FLOOR:
		return fmt::format("You found it lying on the ground {}.", found_where(o_ptr->found_aux2, o_ptr->found_aux1));
	case OBJ_FOUND_VAULT:
		return fmt::format("You found it lying in a vault {}.", found_where(o_ptr->found_aux2, o_ptr->found_aux1));
	case OBJ_FOUND_SPECIAL:
		return "You found it lying on the floor of a special level.";
	case OBJ_FOUND_RUBBLE:
		return "You found it while digging through rubble.";
	case OBJ_FOUND_REWARD:
		return "It was given to you as a reward.";
	case OBJ_FOUND_STORE:
		return fmt::format("You bought it from the {}.", st_info[o_ptr->found_aux1].name);
	case OBJ_FOUND_STOLEN:
		return fmt::format("You stole it from the {}.", st_info[o_ptr->found_aux1].name);
	case OBJ_FOUND_SELFMADE:
		return "You made it yourself.";
	default:
		return "";
	}
}

/* One property of an item: its group, a label and, for a bonus, its amount (and unit). */
void json_prop(JsonWriter &w, char const *group, std::string const &label, long value = 0, char const *unit = "")
{
	w.begin_object();
	w.field("group", group);
	w.field("label", label);
	if (value) w.field("value", value);
	if (*unit) w.field("unit", unit);
	w.end_object();
}

struct flag_label {
	object_flag_set flag;
	char const *group;
	char const *label;
};

/*
 * The properties object_out_desc describes for an item the hero knows, in
 * its order and with its rules (an immunity hides the resistance, a bane the
 * slaying, telepathy the senses), grouped: stat (bonuses, with the pval),
 * attack, immune, resist, sustain, ability and drawback. Stealth is among
 * the bonuses too, as the character sheet shows it; confusion and blindness,
 * which their resistance keeps away entirely, among the immunities, as the
 * character sheet's census lists them.
 */
void json_item_props(JsonWriter &w, object_type const *o_ptr, object_flag_set const &flags)
{
	static const flag_label stats[] = {
		{ TR_STR, "stat", "Strength" },
		{ TR_INT, "stat", "Intelligence" },
		{ TR_WIS, "stat", "Wisdom" },
		{ TR_DEX, "stat", "Dexterity" },
		{ TR_CON, "stat", "Constitution" },
		{ TR_CHR, "stat", "Charisma" },
		{ TR_STEALTH, "stat", "Stealth" },
		{ TR_INFRA, "stat", "Infravision" },
		{ TR_TUNNEL, "stat", "Tunnelling" },
		{ TR_SPEED, "stat", "Speed" },
		{ TR_BLOWS, "stat", "Attack speed" },
		{ TR_CRIT, "stat", "Critical hits" },
		{ TR_LUCK, "stat", "Luck" },
		{ TR_SPELL, "stat", "Spell power" },
	};
	static const flag_label plain[] = {
		{ TR_BRAND_ACID, "attack", "Acid brand" },
		{ TR_BRAND_ELEC, "attack", "Lightning brand" },
		{ TR_BRAND_FIRE, "attack", "Fire brand" },
		{ TR_BRAND_COLD, "attack", "Frost brand" },
		{ TR_BRAND_POIS, "attack", "Poison brand" },
		{ TR_CHAOTIC, "attack", "Chaotic" },
		{ TR_VAMPIRIC, "attack", "Vampiric" },
		{ TR_IMPACT, "attack", "Earthquakes" },
		{ TR_VORPAL, "attack", "Sharp: cuts" },
		{ TR_WOUNDING, "attack", "Sharp: bleeding" },
	};
	static const flag_label slays[] = {
		{ TR_SLAY_ORC, "attack", "Slays orcs" },
		{ TR_SLAY_TROLL, "attack", "Slays trolls" },
		{ TR_SLAY_GIANT, "attack", "Slays giants" },
	};
	static const flag_label after_slays[] = {
		{ TR_SLAY_EVIL, "attack", "Slays evil" },
		{ TR_SLAY_ANIMAL, "attack", "Slays animals" },
		{ TR_INVIS, "ability", "Invisibility" },
		{ TR_SUST_STR, "sustain", "Strength" },
		{ TR_SUST_INT, "sustain", "Intelligence" },
		{ TR_SUST_WIS, "sustain", "Wisdom" },
		{ TR_SUST_DEX, "sustain", "Dexterity" },
		{ TR_SUST_CON, "sustain", "Constitution" },
		{ TR_SUST_CHR, "sustain", "Charisma" },
		{ TR_IM_ACID, "immune", "Acid" },
		{ TR_IM_ELEC, "immune", "Lightning" },
		{ TR_IM_FIRE, "immune", "Fire" },
		{ TR_IM_COLD, "immune", "Cold" },
		{ TR_IM_NETHER, "immune", "Nether" },
		{ TR_FREE_ACT, "immune", "Paralysis" },
		{ TR_RES_FEAR, "immune", "Fear" },
		{ TR_RES_CONF, "immune", "Confusion" },
		{ TR_RES_BLIND, "immune", "Blindness" },
		{ TR_HOLD_LIFE, "resist", "Life draining" },
	};
	static const flag_label resists[] = {
		{ TR_RES_ACID, "resist", "Acid" },
		{ TR_RES_ELEC, "resist", "Lightning" },
		{ TR_RES_FIRE, "resist", "Fire" },
		{ TR_RES_COLD, "resist", "Cold" },
		{ TR_RES_POIS, "resist", "Poison" },
		{ TR_RES_LITE, "resist", "Light" },
		{ TR_RES_DARK, "resist", "Darkness" },
		{ TR_RES_SOUND, "resist", "Sound" },
		{ TR_RES_SHARDS, "resist", "Shards" },
		{ TR_RES_NETHER, "resist", "Nether" },
		{ TR_RES_NEXUS, "resist", "Nexus" },
		{ TR_RES_CHAOS, "resist", "Chaos" },
		{ TR_RES_DISEN, "resist", "Disenchantment" },
	};
	static const object_flag_set immunity_of[] = {
		TR_IM_ACID, TR_IM_ELEC, TR_IM_FIRE, TR_IM_COLD, {}, {}, {}, {}, {}, TR_IM_NETHER, {}, {}, {},
	};
	static_assert(std::size(immunity_of) == std::size(resists));
	static const flag_label abilities[] = {
		{ TR_SENS_FIRE, "drawback", "Vulnerable to fire" },
		{ TR_WRAITH, "ability", "Incorporeal" },
		{ TR_WATER_BREATH, "ability", "Breathes underwater" },
		{ TR_MAGIC_BREATH, "ability", "Breathes without air" },
		{ TR_FEATHER, "ability", "Levitation" },
		{ TR_FLY, "ability", "Flight" },
		{ TR_CLIMB, "ability", "Climbs mountains" },
		{ TR_IMMOVABLE, "ability", "Immovable" },
		{ TR_SEE_INVIS, "ability", "See invisible" },
	};
	static const flag_label senses[] = {
		{ ESP_ORC, "ability", "Senses orcs" },
		{ ESP_TROLL, "ability", "Senses trolls" },
		{ ESP_DRAGON, "ability", "Senses dragons" },
		{ ESP_SPIDER, "ability", "Senses spiders" },
		{ ESP_GIANT, "ability", "Senses giants" },
		{ ESP_DEMON, "ability", "Senses demons" },
		{ ESP_UNDEAD, "ability", "Senses undead" },
		{ ESP_EVIL, "ability", "Senses evil" },
		{ ESP_ANIMAL, "ability", "Senses animals" },
		{ ESP_THUNDERLORD, "ability", "Senses thunderlords" },
		{ ESP_GOOD, "ability", "Senses good" },
		{ ESP_NONLIVING, "ability", "Senses non-living things" },
		{ ESP_UNIQUE, "ability", "Senses unique beings" },
	};
	static const flag_label later[] = {
		{ TR_SLOW_DIGEST, "ability", "Slow digestion" },
		{ TR_REGEN, "ability", "Regeneration" },
		{ TR_REFLECT, "ability", "Reflects bolts and arrows" },
		{ TR_SH_FIRE, "ability", "Fiery aura" },
		{ TR_SH_ELEC, "ability", "Electric aura" },
		{ TR_NO_MAGIC, "ability", "Anti-magic shell" },
		{ TR_NO_TELE, "ability", "Prevents teleportation" },
		{ TR_XTRA_MIGHT, "attack", "Extra might" },
		{ TR_XTRA_SHOTS, "attack", "Extra shots" },
		{ TR_DRAIN_MANA, "drawback", "Drains mana" },
		{ TR_DRAIN_HP, "drawback", "Drains your health" },
		{ TR_DRAIN_EXP, "drawback", "Drains experience" },
		{ TR_BLESSED, "ability", "Blessed" },
		{ TR_TELEPORT, "drawback", "Random teleportation" },
		{ TR_AGGRAVATE, "drawback", "Aggravates creatures" },
		{ TR_NEVER_BLOW, "drawback", "Cannot attack" },
		{ TR_BLACK_BREATH, "drawback", "The Black Breath" },
	};
	static const flag_label curses[] = {
		{ TR_TY_CURSE, "drawback", "Ancient foul curse" },
		{ TR_DG_CURSE, "drawback", "Morgothian curse" },
		{ TR_CLONE, "drawback", "Clones creatures" },
		{ TR_CURSE_NO_DROP, "drawback", "Cannot be dropped while cursed" },
		{ TR_AUTO_CURSE, "drawback", "Can curse itself again" },
		{ TR_CAPACITY, "ability", "Holds more mana" },
		{ TR_CHEAPNESS, "ability", "Cheaper spells" },
		{ TR_FAST_CAST, "ability", "Faster casting" },
		{ TR_CHARGING, "ability", "Regains mana faster" },
		{ TR_RES_MORGUL, "ability", "Resists Morgul shattering" },
	};
	auto each = [&](auto const &table) {
		for (auto const &entry : table)
		{
			if (flags & entry.flag) json_prop(w, entry.group, entry.label);
		}
	};

	w.key("props").begin_array();
	if (flags & TR_LEVELS)
	{
		std::string realms;
		for (std::size_t j = 0; j < flags_groups().size(); j++)
		{
			if (!(BIT(j) & o_ptr->pval3)) continue;
			realms += realms.empty() ? ": " : ", ";
			realms += flags_groups()[j].name;
		}
		json_prop(w, "ability", "Sentient" + realms);
	}
	if (flags & TR_ULTIMATE) json_prop(w, "ability", (wield_slot(o_ptr) == INVEN_WIELD || wield_slot(o_ptr) == INVEN_BOW) ? "One of the ultimate weapons" : "The ultimate armour");
	if (flags & TR_COULD2H) json_prop(w, "attack", "Can be wielded two-handed");
	if (flags & TR_MUST2H) json_prop(w, "attack", "Two-handed");
	{
		int radius = 0;
		if (flags & TR_LITE1) radius += 1;
		if (flags & TR_LITE2) radius += 2;
		if (flags & TR_LITE3) radius += 3;
		radius = std::min(radius, 5);
		if (radius > 0) json_prop(w, "ability", fmt::format("Light, radius {}{}", radius, (flags & TR_FUEL_LITE) ? " when fuelled" : ""));
	}
	if (o_ptr->name1 == ART_ANCHOR) json_prop(w, "ability", "Holds space and time steady");
	if (flags & TR_ANTIMAGIC_50) json_prop(w, "ability", "Anti-magic field");
	if (flags & TR_SPELL_CONTAIN) json_prop(w, "ability", o_ptr->pval2 == -1 ? "Can store a spell" : "Holds a stored spell");
	if (o_ptr->pval)
	{
		for (auto const &entry : stats)
		{
			if (flags & entry.flag) json_prop(w, entry.group, entry.label, o_ptr->pval);
		}
		if (flags & TR_MANA) json_prop(w, "stat", "Mana", 100 * o_ptr->pval / 5, "%");
		if (flags & TR_LIFE) json_prop(w, "stat", "Hit points", 100 * o_ptr->pval / 5, "%");
	}
	each(plain);
	if (flags & TR_KILL_DRAGON) json_prop(w, "attack", "Bane of dragons");
	else if (flags & TR_SLAY_DRAGON) json_prop(w, "attack", "Slays dragons");
	each(slays);
	if (flags & TR_KILL_DEMON) json_prop(w, "attack", "Bane of demons");
	else if (flags & TR_SLAY_DEMON) json_prop(w, "attack", "Slays demons");
	if (flags & TR_KILL_UNDEAD) json_prop(w, "attack", "Bane of undead");
	else if (flags & TR_SLAY_UNDEAD) json_prop(w, "attack", "Slays undead");
	each(after_slays);
	for (std::size_t i = 0; i < std::size(resists); i++)
	{
		if ((flags & resists[i].flag) && !(flags & immunity_of[i])) json_prop(w, "resist", resists[i].label);
	}
	each(abilities);
	if (flags & ESP_ALL) json_prop(w, "ability", "Telepathy");
	else each(senses);
	each(later);
	if (cursed_p(o_ptr))
	{
		json_prop(w, "drawback", (flags & TR_PERMA_CURSE) ? "Permanently cursed" : (flags & TR_HEAVY_CURSE) ? "Heavily cursed" : "Cursed");
	}
	each(curses);
	bool const ignores_all = (flags & TR_IGNORE_ACID) && (flags & TR_IGNORE_FIRE) && (flags & TR_IGNORE_COLD) && (flags & TR_IGNORE_ELEC);
	if (ignores_all) json_prop(w, "ability", "Unharmed by the elements");
	else
	{
		if (flags & TR_IGNORE_ACID) json_prop(w, "ability", "Unharmed by acid");
		if (flags & TR_IGNORE_ELEC) json_prop(w, "ability", "Unharmed by lightning");
		if (flags & TR_IGNORE_FIRE) json_prop(w, "ability", "Unharmed by fire");
		if (flags & TR_IGNORE_COLD) json_prop(w, "ability", "Unharmed by cold");
	}
	w.end_array();
}

/*
 * An edged weapon the hero's god frowns on (Eru: calc_bonuses' penalty for
 * a sword, axe or polearm unless something worn is blessed), counting what
 * else is worn but not the weapon it would replace.
 */
static bool unholy_weapon(object_type const *o_ptr)
{
	bool const edged = o_ptr->tval == TV_SWORD || o_ptr->tval == TV_AXE || o_ptr->tval == TV_POLEARM;
	if (!edged || !forbid_non_blessed() || blessed(o_ptr)) return false;
	int const replaced = wield_slot(o_ptr);
	for (int i = INVEN_WIELD; i < INVEN_TOTAL; i++)
	{
		object_type const *worn = &p_ptr->inventory[i];
		if (i != replaced && worn != o_ptr && worn->k_ptr && (object_flags(worn) & TR_BLESSED)) return false;
	}
	return true;
}

/*
 * What the hero knows of an item, as tome2's examining tells it
 * (object_out_desc on the screen, and a book's browsing as a shop's examine
 * adds): see web_object_info.
 */
char const *item_info_json(object_type *o_ptr)
{
	auto w = start_json();
	w.begin_object();
	if (!o_ptr || !o_ptr->k_ptr)
	{
		w.end_object();
		return json.c_str();
	}
	auto const &a_info = game->edit_data.a_info;
	auto const &set_info = game->edit_data.set_info;
	stick_mode_kept const kept;
	bool const known = object_known_p(o_ptr);
	auto const flags = object_flags(o_ptr);
	w.field("known", known ? 1 : 0);
	if (unholy_weapon(o_ptr)) w.field("unholy", deity_info[p_ptr->pgod].name);
	for (int tv = 0; tval_descs[tv].tval; tv++)
	{
		if (tval_descs[tv].tval != o_ptr->tval) continue;
		w.field("kind", tval_descs[tv].desc);
		break;
	}

	if (known)
	{
		w.key("lore").begin_array();
		if (!o_ptr->k_ptr->text.empty()) w.value(o_ptr->k_ptr->text);
		if (o_ptr->name1)
		{
			auto const &artifact = a_info[o_ptr->name1];
			if (artifact.text && *artifact.text) w.value(artifact.text);
		}
		w.end_array();
		if (o_ptr->name1 && a_info[o_ptr->name1].set != -1) w.field("set", set_info[a_info[o_ptr->name1].set].desc);

		json_item_props(w, o_ptr, flags);
		if (flags & TR_ACTIVATE)
		{
			w.field("activation", item_activation(o_ptr));
			w.field("worn", (flags & TR_ACTIVATE_NO_WIELD) ? 0 : 1);
		}
		if (auto power_idx = object_power(o_ptr)) w.field("power", game->powers.at(*power_idx)->name);

		if (wield_slot(o_ptr) == INVEN_WIELD)
		{
			json_damage(w, "melee", text_out_runs([o_ptr] { display_weapon_damage(o_ptr); }), true);
		}
		bool const ammo = wield_slot(o_ptr) == INVEN_AMMO;
		if (o_ptr->tval == TV_BOOMERANG || ammo)
		{
			json_damage(w, o_ptr->tval == TV_BOOMERANG ? "thrown" : "missile", text_out_runs([o_ptr] { display_ammo_damage(o_ptr); }), false);
			if (artifact_p(o_ptr)) w.field("breaks", 0);
			else if (o_ptr->tval == TV_BOOMERANG) w.field("breaks", 1);
			else if (o_ptr->pval2 == 0) w.field("breaks", breakage_chance(o_ptr));
			if (ammo && o_ptr->pval2)
			{
				for (int i = 0; gf_names[i].gf != -1; i++)
				{
					if (gf_names[i].gf == o_ptr->pval2) w.field("explosion", gf_names[i].name);
				}
			}
		}
		if (o_ptr->tval == TV_TOTEM || o_ptr->tval == TV_CORPSE)
		{
			int const r_idx = o_ptr->tval == TV_TOTEM ? o_ptr->pval : o_ptr->pval2;
			json_runs(w, "recall", text_out_runs([r_idx] { monster_description_out(r_idx, 0); }));
		}
	}

	if (known && (o_ptr->tval == TV_WAND || o_ptr->tval == TV_STAFF))
	{
		stick_mode_of const device(o_ptr);
		spell_type *spell = spell_at(o_ptr->pval2);
		w.key("device").begin_object();
		json_spell_common(w, spell);
		w.field("level", get_level(o_ptr->pval2, 50));
		w.field("fail", spell_chance_device(spell));
		w.end_object();
	}

	int sval;
	s32b pval;
	bool const holds = known || ((o_ptr->tval == TV_BOOK || o_ptr->tval == TV_DAEMON_BOOK || o_ptr->tval == TV_INSTRUMENT) && o_ptr->k_ptr->aware);
	if (holds && spell_book_of(o_ptr, &sval, &pval))
	{
		random_book_setup(sval, pval);
		if (school_book *sb = school_books_at(sval))
		{
			w.key("spells").begin_array();
			for (auto spell_idx : sb->spell_idxs) json_spell(w, spell_idx, o_ptr->pval);
			w.end_array();
		}
	}

	auto const found = found_text(o_ptr);
	if (!found.empty()) w.field("found", found);
	w.end_object();
	return json.c_str();
}

}

/*
 * Every message tome2 adds, counted: its log keeps only the last 2048, so its
 * size stops growing there. Messages::add(std::string, byte), which the
 * const char * form calls, is wrapped at link time (CMakeLists.txt); a
 * message the same as the last only adds to its count, as in tome2.
 */
static long messages_added = 0;

#define MESSAGES_ADD _ZN8Messages3addERKNSt3__212basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEEh
extern "C" void BOOST_PP_CAT(__real_, MESSAGES_ADD)(Messages *self, std::string const &msg, byte color);

extern "C" void BOOST_PP_CAT(__wrap_, MESSAGES_ADD)(Messages *self, std::string const &msg, byte color)
{
	if (self->size() == 0 || self->at(0).text != msg) messages_added++;
	BOOST_PP_CAT(__real_, MESSAGES_ADD)(self, msg, color);
}

extern "C" {

/*
 * Whether messages flow past without -more- pauses (tome2's auto_more
 * option). Applied on every snapshot, so loading a savefile cannot undo it.
 */
EMSCRIPTEN_KEEPALIVE void web_set_auto_more(int on)
{
	auto_more_override = on < 0 ? -1 : (on ? 1 : 0);
	if (auto_more_override >= 0 && options) options->auto_more = auto_more_override != 0;
}

/*
 * How long tome2 shows each step of a bolt or blast (its delay_factor: the
 * cube, in ms), so they are drawn and heard. Applied on every snapshot, so
 * loading a savefile cannot undo it.
 */
EMSCRIPTEN_KEEPALIVE void web_set_effect_delay(int factor)
{
	delay_override = factor < 0 ? -1 : std::min(factor, 9);
	if (delay_override >= 0 && options) options->delay_factor = delay_override;
}

/*
 * Rebuilds the level arrays and returns the header (see HeaderSlot).
 */
EMSCRIPTEN_KEEPALIVE int32_t const *web_snapshot()
{
	auto const &f_info = game->edit_data.f_info;

	bool const ready = level_ready();

	if (auto_more_override >= 0 && options) options->auto_more = auto_more_override != 0;
	if (delay_override >= 0 && options) options->delay_factor = delay_override;
	/* The hero is drawn as their race's symbol, as in the snapshot, never as a digit for their health. */
	if (options) options->player_char_health = false;
	/* The frontend saves on arriving on another level; tome2's own autosaves stay off. */
	if (options)
	{
		options->autosave_l = false;
		options->autosave_t = false;
	}
	web_memory_tick();
	web_run_options_tick();
	web_adventure_tick();

	header[H_VERSION] = SNAPSHOT_VERSION;
	header[H_IN_DUNGEON] = ready ? 1 : 0;
	header[H_ICKY] = character_icky ? 1 : 0;
	header[H_ROW_MAP] = ROW_MAP;
	header[H_COL_MAP] = COL_MAP;
	header[H_PTR_FEAT] = ptr(feat_buf.data());
	header[H_PTR_INFO] = ptr(info_buf.data());
	header[H_PTR_GLYPH] = ptr(glyph_buf.data());
	header[H_PTR_ATTR] = ptr(attr_buf.data());
	header[H_PTR_LAYER] = ptr(layer_buf.data());
	header[H_PTR_EFFECT] = ptr(effect_buf.data());
	header[H_AT_COMMAND] = (inkey_flag && !character_icky) ? 1 : 0;
	/* The hero's own command is under way (tome2 takes its energy once it is done). */
	header[H_HERO_ACTING] = (character_generated && p_ptr->energy >= 100 && !inkey_flag) ? 1 : 0;
	header[H_TURN] = static_cast<int32_t>(turn);
	header[H_FLOOR_OBJECTS] = 0;

	if (!ready)
	{
		header[H_WIDTH] = 0;
		header[H_HEIGHT] = 0;
		return header;
	}

	int const w = std::min<int>(cur_wid, MAX_WID);
	int const h = std::min<int>(cur_hgt, MAX_HGT);

	header[H_WIDTH] = w;
	header[H_HEIGHT] = h;
	header[H_PY] = p_ptr->py;
	header[H_PX] = p_ptr->px;
	header[H_LIGHT_RADIUS] = p_ptr->cur_lite;
	header[H_DEPTH] = dun_level;
	header[H_WILD_MODE] = p_ptr->wild_mode ? 1 : 0;
	header[H_BLIND] = p_ptr->blind ? 1 : 0;
	header[H_HALLUCINATING] = p_ptr->image ? 1 : 0;
	header[H_PANEL_ROW] = panel_row_min;
	header[H_PANEL_COL] = panel_col_min;
	header[H_FLOOR_OBJECTS] = static_cast<int32_t>(cave[p_ptr->py][p_ptr->px].o_idxs.size());

	for (int y = 0; y < h; y++)
	{
		for (int x = 0; x < w; x++)
		{
			int const i = y * w + x;
			cave_type const *c_ptr = &cave[y][x];

			feat_buf[i] = c_ptr->mimic ? c_ptr->mimic : f_info[c_ptr->feat].mimic;
			info_buf[i] = c_ptr->info;
			cell_glyph(y, x, &glyph_buf[i], &attr_buf[i], &layer_buf[i], &effect_buf[i]);
		}
	}

	return header;
}

/*
 * The digging skill that gets through a feature at 1% a turn, as
 * do_cmd_tunnel_aux rates it (its skill_req_1pct), or -1 for terrain tome2
 * does not tunnel, permanent walls and doors.
 */
static int dig_skill(int feat)
{
	auto const &f = game->edit_data.f_info[feat];
	if (!(f.flags & FF_TUNNELABLE) || (f.flags & FF_PERMANENT)) return -1;
	if ((feat == FEAT_TREES) || (feat == FEAT_DEAD_TREE)) return 14;
	if ((feat >= FEAT_WALL_EXTRA) && (feat <= FEAT_WALL_SOLID)) return 56;
	if (((feat >= FEAT_MAGMA) && (feat <= FEAT_QUARTZ_K)) || ((feat >= FEAT_SANDWALL) && (feat <= FEAT_SANDWALL_K)))
	{
		if ((feat == FEAT_SANDWALL_H) || (feat == FEAT_SANDWALL_K)) return 8;
		return ((feat - FEAT_MAGMA) & 0x01) ? 28 : 14;
	}
	if (feat == FEAT_RUBBLE) return 2;
	if ((feat >= FEAT_DOOR_HEAD) && (feat <= FEAT_DOOR_TAIL)) return -1;
	return 42;
}

/*
 * Returns the terrain feature table as JSON: [{name, ch, attr, flags, dig?, god?}, ...].
 */
EMSCRIPTEN_KEEPALIVE char const *web_features_json()
{
	auto const &f_info = game->edit_data.f_info;

	auto w = start_json();
	w.begin_array();

	for (std::size_t i = 0; i < f_info.size(); i++)
	{
		auto const &f = f_info[i];
		uint32_t bits = 0;

		if (f.flags & FF_NO_WALK) bits |= FB_NO_WALK;
		if (f.flags & FF_NO_VISION) bits |= FB_NO_VISION;
		if (f.flags & FF_FLOOR) bits |= FB_FLOOR;
		if (f.flags & FF_WALL) bits |= FB_WALL;
		if (f.flags & FF_PERMANENT) bits |= FB_PERMANENT;
		if (f.flags & FF_DOOR) bits |= FB_DOOR;
		if (f.flags & FF_ATTR_MULTI) bits |= FB_ATTR_MULTI;
		if (f.flags & FF_REMEMBER) bits |= FB_REMEMBER;

		w.begin_object();
		w.field("name", f.name);
		w.field("ch", static_cast<unsigned char>(f.x_char));
		w.field("attr", f.x_attr);
		w.field("flags", bits);
		if (int const dig = dig_skill(static_cast<int>(i)); dig >= 0) w.field("dig", dig);
		if (auto const *god = altar_god(static_cast<int>(i))) w.field("god", god->name);
		w.end_object();
	}

	w.end_array();
	return json.c_str();
}

/*
 * Terrain that tome2 does not let one walk on but the hero can enter now, by
 * feature index (player_can_enter): trees for a tree walker, a flyer or a
 * follower of Yavanna praying with enough piety, and the like. Walls that
 * neither flying nor climbing passes (tome2 counts trees as walls) are left
 * out, so walking through them in a wraith's form shapes no journey.
 */
static void json_passes(JsonWriter &w)
{
	auto const &f_info = game->edit_data.f_info;
	w.key("passes").begin_array();
	for (std::size_t i = 0; i < f_info.size() && i < 256; i++)
	{
		auto const flags = f_info[i].flags;
		bool const wall = (flags & FF_WALL) && !(flags & (FF_CAN_FLY | FF_CAN_CLIMB));
		if ((flags & FF_NO_WALK) && !wall && player_can_enter(static_cast<byte>(i))) w.value(static_cast<int>(i));
	}
	w.end_array();
}

/* One effect in force: its id, the turns it has left (none when it does not count down by turns), then its own fields. */
static void json_effect(JsonWriter &w, char const *id, long turns, std::function<void()> const &extra = {})
{
	w.begin_object();
	w.field("id", id);
	if (turns > 0) w.field("turns", turns);
	if (extra) extra();
	w.end_object();
}

/* tome2's timed effects that count down by one each turn and carry nothing else. */
struct TimedField
{
	char const *id;
	s16b player_type::*field;
};

static constexpr TimedField TIMED_FIELDS[] = {
	{ "blind", &player_type::blind },
	{ "confused", &player_type::confused },
	{ "afraid", &player_type::afraid },
	{ "paralyzed", &player_type::paralyzed },
	{ "hallucinating", &player_type::image },
	{ "slow", &player_type::slow },
	{ "parasite", &player_type::parasite },
	{ "lightspeed", &player_type::lightspeed },
	{ "invuln", &player_type::invuln },
	{ "disruption", &player_type::disrupt_shield },
	{ "wraith", &player_type::tim_wraith },
	{ "shero", &player_type::shero },
	{ "hero", &player_type::hero },
	{ "blessed", &player_type::blessed },
	{ "holy", &player_type::holy },
	{ "strike", &player_type::strike },
	{ "protevil", &player_type::protevil },
	{ "reflect", &player_type::tim_reflect },
	{ "resistAcid", &player_type::oppose_acid },
	{ "resistElec", &player_type::oppose_elec },
	{ "resistFire", &player_type::oppose_fire },
	{ "resistCold", &player_type::oppose_cold },
	{ "resistPois", &player_type::oppose_pois },
	{ "resistChaos", &player_type::oppose_cc },
	{ "poisonHands", &player_type::tim_poison },
	{ "absorbSoul", &player_type::absorb_soul },
	{ "probability", &player_type::prob_travel },
	{ "telepathy", &player_type::tim_esp },
	{ "seeInvisible", &player_type::tim_invis },
	{ "infravision", &player_type::tim_infra },
	{ "light", &player_type::tim_lite },
	{ "flight", &player_type::tim_fly },
	{ "levitation", &player_type::tim_ffall },
	{ "waterBreath", &player_type::tim_water_breath },
	{ "magicBreath", &player_type::tim_magic_breath },
	{ "precognition", &player_type::tim_precognition },
};

static char const *gf_name(int gf)
{
	for (int i = 0; gf_names[i].gf != -1; i++)
	{
		if (gf_names[i].gf == gf) return gf_names[i].name;
	}
	return "";
}

static std::string dice(int number, int sides)
{
	return fmt::format("{}d{}", number, sides);
}

/*
 * The effects in force on the hero, as tome2 keeps them (`calc_bonuses`,
 * `process_world`). A timed effect's `turns` are those tome2 counts: one each
 * turn at normal speed (every 10 game turns). Poison, stuns and cuts heal by
 * an amount that grows with Constitution each turn (`adj_con_fix`), so their
 * turns are worked out from it; a mortal wound never heals by itself. Some
 * count down by other things: great blows by the blow, Dripping Tread by the
 * step, undead form by the kill. Sustained effects (a song, Inertia Control,
 * a borrowed body) carry what keeps them going instead.
 */
static void json_effects(JsonWriter &w)
{
	auto const &r_info = game->edit_data.r_info;
	int const heal = adj_con_fix[p_ptr->stat_ind[A_CON]] + 1;
	auto healing = [heal](int amount) { return (amount + heal - 1) / heal; };

	w.key("effects").begin_array();

	for (auto const &t : TIMED_FIELDS)
	{
		if (p_ptr->*t.field > 0) json_effect(w, t.id, p_ptr->*t.field);
	}

	if (p_ptr->poisoned > 0) json_effect(w, "poisoned", healing(p_ptr->poisoned));
	if (p_ptr->stun > 0) json_effect(w, "stun", healing(p_ptr->stun), [&] { w.field("level", p_ptr->stun); });
	if (p_ptr->cut > 0) json_effect(w, "cut", p_ptr->cut > 1000 ? 0 : healing(p_ptr->cut), [&] { w.field("level", p_ptr->cut); });
	if (p_ptr->black_breath) json_effect(w, "blackBreath", 0);
	for (int i = 0; i < 6; i++)
	{
		if (p_ptr->stat_cnt[i] > 0) json_effect(w, "drained", p_ptr->stat_cnt[i], [&] { w.field("stat", stat_names[i]); });
	}

	if (p_ptr->fast > 0) json_effect(w, "fast", p_ptr->fast, [&] { w.field("speed", p_ptr->speed_factor); });
	if (p_ptr->shield > 0)
	{
		json_effect(w, "shield", p_ptr->shield, [&] {
			w.field("armour", p_ptr->shield_power);
			auto const opt = p_ptr->shield_opt;
			char const *aura = (opt & SHIELD_GREAT_FIRE) ? "greatFire" : (opt & SHIELD_FIRE) ? "fire" : (opt & SHIELD_COUNTER) ? "counter" : (opt & SHIELD_FEAR) ? "fear" : "";
			if (*aura)
			{
				w.field("aura", aura);
				w.field("dice", dice(p_ptr->shield_power_opt, p_ptr->shield_power_opt2));
			}
		});
	}
	if (p_ptr->tim_regen > 0) json_effect(w, "regen", p_ptr->tim_regen, [&] { w.field("power", p_ptr->tim_regen_pow); });
	if (p_ptr->tim_invisible > 0) json_effect(w, "invisible", p_ptr->tim_invisible, [&] { w.field("power", p_ptr->tim_inv_pow); });
	if (p_ptr->tim_roots > 0)
	{
		json_effect(w, "roots", p_ptr->tim_roots, [&] {
			w.field("armour", p_ptr->tim_roots_ac);
			w.field("damage", p_ptr->tim_roots_dam);
		});
	}
	if (p_ptr->tim_thunder > 0) json_effect(w, "thunder", p_ptr->tim_thunder, [&] { w.field("dice", dice(p_ptr->tim_thunder_p1, p_ptr->tim_thunder_p2)); });
	if (p_ptr->tim_project > 0)
	{
		json_effect(w, "project", p_ptr->tim_project, [&] {
			w.field("element", gf_name(p_ptr->tim_project_gf));
			w.field("damage", p_ptr->tim_project_dam);
			w.field("radius", p_ptr->tim_project_rad);
		});
	}
	if (p_ptr->tim_deadly > 0) json_effect(w, "deadly", 0, [&] { w.field("blows", p_ptr->tim_deadly); });
	if (p_ptr->dripping_tread > 0) json_effect(w, "tread", 0, [&] { w.field("steps", p_ptr->dripping_tread); });
	if (p_ptr->confusing) json_effect(w, "confusing", 0);
	if (p_ptr->word_recall > 0) json_effect(w, "recall", p_ptr->word_recall, [&] { w.field("up", dun_level > 0 ? 1 : 0); });
	if (no_breeds > 0) json_effect(w, "noBreeds", no_breeds);

	if (p_ptr->tim_mimic > 0) json_effect(w, "mimic", p_ptr->tim_mimic, [&] { w.field("form", get_mimic_name(p_ptr->mimic_form)); });
	if (p_ptr->body_monster && static_cast<std::size_t>(p_ptr->body_monster) < r_info.size())
	{
		json_effect(w, "body", 0, [&] { w.field("form", r_info[p_ptr->body_monster].name ? r_info[p_ptr->body_monster].name : ""); });
	}
	{
		int const limbs = p_ptr->mimic_extra >> 16;
		auto const att = p_ptr->mimic_extra & 0xFFFF;
		if (limbs > 0 && (att & CLASS_LEGS)) json_effect(w, "mimicLegs", limbs);
		if (limbs > 0 && (att & CLASS_ARMS)) json_effect(w, "mimicArms", limbs);
		if (limbs > 0 && (att & CLASS_WALL)) json_effect(w, "mimicWall", limbs);
	}
	if (p_ptr->necro_extra & CLASS_UNDEAD) json_effect(w, "undead", 0, [&] { w.field("kills", p_ptr->necro_extra2); });
	stick_mode_kept const kept;
	if (p_ptr->music_extra)
	{
		auto const spell_idx = -static_cast<s32b>(p_ptr->music_extra);
		json_effect(w, "song", 0, [&] {
			w.field("spell", spell_type_name(spell_at(spell_idx)));
			/* What each song's lasting effect takes a turn and renews (spells3.cc): the Song of the Sun one mana, the others their mana. */
			w.field("mana", spell_idx == MUSIC_LITE ? 1 : get_mana(spell_idx));
			w.key("renews").begin_array();
			if (spell_idx == MUSIC_HERO) for (auto const *id : { "hero", "shero", "strike", "resistChaos" }) w.value(id);
			if (spell_idx == MUSIC_TIME) for (auto const *id : { "shield", "fast" }) w.value(id);
			if (spell_idx == MUSIC_MIND) w.value("telepathy");
			if (spell_idx == MUSIC_LITE) w.value("light");
			w.end_array();
		});
	}
	if (p_ptr->inertia_controlled_spell != -1)
	{
		auto const spell_idx = p_ptr->inertia_controlled_spell;
		json_effect(w, "inertia", 0, [&] {
			w.field("spell", spell_type_name(spell_at(spell_idx)));
			w.field("mana", get_mana(spell_idx) * 4);
			w.field("every", TIMER_INERTIA_CONTROL->m_delay);
			w.field("next", TIMER_INERTIA_CONTROL->m_countdown);
		});
	}
	auto const &binder = p_ptr->spellbinder;
	if (binder.trigger && !binder.spell_idxs.empty())
	{
		json_effect(w, "spellbinder", 0, [&] {
			w.field("at", binder.trigger == SPELLBINDER_HP75 ? 75 : binder.trigger == SPELLBINDER_HP50 ? 50 : 25);
			w.key("spells").begin_array();
			for (auto const idx : binder.spell_idxs) w.value(spell_type_name(spell_at(idx)));
			w.end_array();
		});
	}

	w.end_array();
}

/*
 * Returns player, visible monster/object and recent message state as JSON.
 */
EMSCRIPTEN_KEEPALIVE char const *web_state_json(int max_messages)
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();

	/* Player */
	w.key("player").begin_object();
	w.field("name", game->player_name);
	w.field("race", rp_ptr ? rp_ptr->title : "");
	w.field("cls", spp_ptr ? spp_ptr->title : (cp_ptr ? cp_ptr->title : ""));
	if (cp_ptr && p_ptr->lev >= 1)
	{
		std::size_t idx = static_cast<std::size_t>((p_ptr->lev - 1) / 5);
		if (idx < cp_ptr->titles.size()) w.field("title", cp_ptr->titles[idx]);
	}
	w.field("lev", p_ptr->lev);
	w.field("exp", p_ptr->exp);
	w.field("au", p_ptr->au);
	w.field("chp", p_ptr->chp);
	w.field("mhp", p_ptr->mhp);
	w.field("csp", p_ptr->csp);
	w.field("msp", p_ptr->msp);
	w.field("csane", p_ptr->csane);
	w.field("msane", p_ptr->msane);
	w.field("speed", p_ptr->pspeed - 110);
	w.field("food", p_ptr->food);
	w.field("depth", dun_level);
	w.field("dungeon", game->edit_data.d_info[dungeon_type].name);
	w.field("wild", p_ptr->wild_mode ? 1 : 0);
	w.field("alwaysPickup", options->always_pickup ? 1 : 0);
	w.field("skillPoints", p_ptr->skill_points);
	w.field("pray", p_ptr->pgod == GOD_NONE ? 0 : p_ptr->praying ? 2 : 1);
	w.field("god", p_ptr->pgod == GOD_NONE ? "" : deity_info[p_ptr->pgod].name);
	w.field("piety", p_ptr->grace);
	if (race_flags_p(PR_NO_GOD)) w.field("faithless", "race");
	else if (get_skill(SKILL_ANTIMAGIC) > 0) w.field("faithless", "antimagic");
	json_passes(w);
	/* The hero's digging skill, with a digger in the tool slot and unless they pass through walls (player_can_enter). */
	auto const &tool = p_ptr->inventory[INVEN_TOOL];
	if (tool.k_ptr && (tool.tval == TV_DIGGING) && !p_ptr->wraith_form && !race_flags_p(PR_SEMI_WRAITH)) w.field("dig", p_ptr->skill_dig);
	w.field("runes", static_cast<int>(std::count(p_ptr->inscriptions.begin(), p_ptr->inscriptions.end(), true)));
	w.field("control", p_ptr->control);
	w.field("dead", death ? 1 : 0);
	w.field("diedFrom", game->died_from);
	json_adventure(w);
	json_level_quest(w);
	json_quests(w, false);
	json_effects(w);
	w.end_object();

	/* Visible monsters */
	w.key("monsters").begin_array();
	for (int i = 1; i < m_max; i++)
	{
		monster_type const *m_ptr = &m_list[i];

		if (!m_ptr->r_idx || !m_ptr->ml) continue;

		auto r_ptr = m_ptr->race();

		if (r_ptr->flags & RF_MIMIC) continue;

		w.begin_object();
		w.field("id", i);
		w.field("name", r_ptr->name ? r_ptr->name : "");
		w.field("ch", static_cast<unsigned char>(r_ptr->x_char));
		w.field("attr", r_ptr->x_attr);
		w.field("y", m_ptr->fy);
		w.field("x", m_ptr->fx);
		w.field("hp", m_ptr->hp);
		w.field("maxhp", m_ptr->maxhp);
		w.field("asleep", m_ptr->csleep ? 1 : 0);
		w.field("afraid", m_ptr->monfear ? 1 : 0);
		w.field("unique", (r_ptr->flags & RF_UNIQUE) ? 1 : 0);
		w.field("status", m_ptr->status);
		bool const inView = projectable(p_ptr->py, p_ptr->px, m_ptr->fy, m_ptr->fx);
		w.field("view", inView ? 1 : 0);
		w.field("target", inView && !p_ptr->image && !(r_ptr->flags & RF_NO_TARGET) ? 1 : 0);
		w.field("quest", (m_ptr->mflag & MFLAG_QUEST) ? 1 : 0);
		w.field("level", r_ptr->level);
		w.end_object();
	}
	w.end_array();

	/* Visible objects */
	w.key("objects").begin_array();
	for (int i = 1; i < o_max; i++)
	{
		object_type const *o_ptr = &o_list[i];

		if (!o_ptr->k_ptr || o_ptr->held_m_idx || !o_ptr->marked) continue;
		if (o_ptr->iy >= cur_hgt || o_ptr->ix >= cur_wid) continue;
		if (!(cave[o_ptr->iy][o_ptr->ix].info & CAVE_SEEN)) continue;

		char name[160];
		object_desc(name, o_ptr, true, 0);

		w.begin_object();
		w.field("id", i);
		w.field("name", name);
		w.field("ch", static_cast<unsigned char>(object_char(o_ptr)));
		w.field("attr", object_attr(o_ptr));
		w.field("gold", o_ptr->tval == TV_GOLD ? 1 : 0);
		w.field("y", o_ptr->iy);
		w.field("x", o_ptr->ix);
		w.end_object();
	}
	w.end_array();

	/* Recent messages, newest first */
	auto const &messages = game->messages;
	int const count = std::min<int>(messages.size(), std::max(0, max_messages));
	w.field("messageTotal", messages_added);
	w.key("messages").begin_array();
	for (int age = 0; age < count; age++)
	{
		auto const &m = messages.at(age);
		w.begin_object();
		w.field("text", m.text_with_count());
		w.field("color", m.color);
		w.end_object();
	}
	w.end_array();
	w.end_object();

	return json.c_str();
}


/*
 * What the hero perceives or remembers at a grid, as tome2's look command
 * tells it: {known, view, name, objects: [{id, name, ch, attr, gold}]}.
 * known: the grid is remembered or in view (else nothing more is said);
 * view: it is in view now. name: its terrain (a mimic's disguise, a shop's
 * name, where a dungeon's entrance leads), empty when unknown. objects: every
 * object the hero has noticed there (tome2's `marked`), seen now or
 * remembered, and the object a sleeping mimic passes for. Creatures come
 * from web_state_json.
 */
EMSCRIPTEN_KEEPALIVE char const *web_grid_json(int y, int x)
{
	auto const &f_info = game->edit_data.f_info;
	auto const &st_info = game->edit_data.st_info;
	auto const &d_info = game->edit_data.d_info;

	auto w = start_json();
	w.begin_object();
	if (!level_ready() || !in_bounds2(y, x))
	{
		w.field("known", 0);
		w.end_object();
		return json.c_str();
	}
	cave_type const *c_ptr = &cave[y][x];
	bool const view = player_can_see_bold(y, x);
	bool const known = view || (c_ptr->info & CAVE_MARK);
	w.field("known", known ? 1 : 0);
	w.field("view", view ? 1 : 0);

	std::string name;
	if (known)
	{
		auto const feat = c_ptr->mimic ? c_ptr->mimic : f_info[c_ptr->feat].mimic;
		auto const special = static_cast<std::size_t>(c_ptr->special);
		if (feat == FEAT_SHOP && special < st_info.size()) name = st_info[special].name;
		else if (feat == FEAT_MORE && c_ptr->special && special < d_info.size()) name = d_info[special].text;
		else name = f_info[feat].name;
	}
	w.field("name", name);
	if (known)
	{
		if (auto const *god = altar_god(c_ptr->mimic ? c_ptr->mimic : c_ptr->feat)) w.field("god", god->name);
	}

	std::vector<object_type const *> objects;
	if (c_ptr->m_idx)
	{
		monster_type const *m_ptr = &m_list[c_ptr->m_idx];
		if ((m_ptr->race()->flags & RF_MIMIC) && m_ptr->csleep) objects.push_back(&o_list[m_ptr->mimic_o_idx()]);
	}
	for (auto const o_idx : c_ptr->o_idxs) objects.push_back(&o_list[o_idx]);

	w.key("objects").begin_array();
	for (auto const *o_ptr : objects)
	{
		if (!o_ptr->k_ptr || !o_ptr->marked) continue;
		char o_name[160];
		object_desc(o_name, o_ptr, true, 3);
		w.begin_object();
		w.field("id", static_cast<int>(o_ptr - o_list));
		w.field("name", o_name);
		w.field("ch", static_cast<unsigned char>(object_char(o_ptr)));
		w.field("attr", object_attr(o_ptr));
		w.field("gold", o_ptr->tval == TV_GOLD ? 1 : 0);
		w.end_object();
	}
	w.end_array();
	w.end_object();
	return json.c_str();
}


/*
 * A message of our own (a stop reason, a refusal, a deed) added to tome2's
 * message log in NOTICE_COLOUR, which no tome2 message uses, so the log and
 * history show it and readers of tome2's messages can leave it out. The
 * text is written to the buffer web_notice_buffer returns.
 */
extern int const NOTICE_COLOUR = 16;
static std::vector<char> notice_text;

EMSCRIPTEN_KEEPALIVE char *web_notice_buffer(int bytes)
{
	notice_text.assign(static_cast<std::size_t>(std::max(0, bytes)) + 1, '\0');
	return notice_text.data();
}

EMSCRIPTEN_KEEPALIVE void web_add_notice()
{
	if (!level_ready() || notice_text.empty() || !notice_text[0]) return;
	notice_text.back() = '\0';
	game->messages.add(notice_text.data(), NOTICE_COLOUR);
}

/*
 * Returns the pack, equipment and items underfoot as JSON. Item "i" is the
 * inventory index (equipment from INVEN_WIELD) or minus the o_list index for
 * floor items.
 */
EMSCRIPTEN_KEEPALIVE char const *web_inventory_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();

	w.field("weight", calc_total_weight());
	w.field("limit", weight_limit());

	w.key("pack").begin_array();
	for (int i = 0; i < INVEN_PACK; i++)
	{
		object_type const *o_ptr = &p_ptr->inventory[i];
		if (o_ptr->k_ptr) json_object(w, i, o_ptr);
	}
	w.end_array();

	w.key("equip").begin_array();
	for (int i = INVEN_WIELD; i < INVEN_TOTAL; i++)
	{
		int const part = p_ptr->body_parts[i - INVEN_WIELD];
		if (!part) continue;
		object_type const *o_ptr = &p_ptr->inventory[i];
		w.begin_object();
		if (o_ptr->k_ptr)
		{
			json_object_fields(w, i, o_ptr);
		}
		else
		{
			w.field("i", i);
			w.field("empty", 1);
		}
		w.field("part", part);
		w.end_object();
	}
	w.end_array();

	w.key("floor").begin_array();
	for (auto const o_idx : cave[p_ptr->py][p_ptr->px].o_idxs)
	{
		object_type const *o_ptr = &o_list[o_idx];
		if (o_ptr->k_ptr) json_object(w, -o_idx, o_ptr);
	}
	w.end_array();
	w.end_object();

	return json.c_str();
}

/*
 * What the player knows about an item (see web_inventory_json for the index)
 * as JSON, as tome2's examining tells it: "known" (identified), "kind" (what
 * such things are), "lore" (the kind's and an artifact's texts) and "set";
 * "props" [{group, label, value, unit}] (see json_item_props); "activation"
 * (and "worn": only while worn), "power" granted; "melee" and "missile"
 * damage ({blows, rows: [{against, damage}]}, for the hero as they are),
 * "thrown" for a boomerang, "breaks" (chance in percent), "explosion"; "recall" of a corpse's or
 * totem's creature (coloured runs); "device" (a wand's or staff's spell),
 * "spells" (a book's, an instrument's or a stored spell, as web_spells_json);
 * "found" (how the hero came by it). Unidentified, only "kind", "found" and
 * a known book's spells.
 */
EMSCRIPTEN_KEEPALIVE char const *web_object_info(int item)
{
	bool const valid = level_ready() && item < INVEN_TOTAL && (item >= 0 || -item < o_max);
	return item_info_json(valid ? get_object(item) : nullptr);
}

/* What the player knows about an item on the shelf of the shop (or home) they are in, by its position in the stock, as web_object_info. */
EMSCRIPTEN_KEEPALIVE char const *web_store_object_info(int index)
{
	store_type *st = store_here();
	bool const valid = st && index >= 0 && index < static_cast<int>(st->stock.size());
	return item_info_json(valid ? &st->stock[index] : nullptr);
}

/*
 * The shop (or home) on the player's grid as JSON, or {"here":0}: its name
 * and keeper, its commands (letter, tome2 action code, gold it costs, closed
 * to the hero, name), its whole stock (price of one to buy, as tome2 decides
 * how many the hero can afford; none in the home), and for each item carried whether
 * the shop takes it and what it pays for one ("why" says why not: "kind",
 * "worthless", "cursed", "full": no room on its shelves, "nothing").
 */
EMSCRIPTEN_KEEPALIVE char const *web_store_json()
{
	auto const &st_info = game->edit_data.st_info;
	auto const &ow_info = game->edit_data.ow_info;
	auto const &ba_info = game->edit_data.ba_info;

	auto w = start_json();
	w.begin_object();
	int which = 0;
	store_type *st = store_here(&which);
	if (!st || st->st_idx >= st_info.size() || st->owner >= ow_info.size())
	{
		w.field("here", 0);
		w.end_object();
		return json.c_str();
	}
	auto const &info = st_info[st->st_idx];
	auto const &owner = ow_info[st->owner];
	bool const home = which == HOME_STORE;
	bool const museum = bool(info.flags & STF_MUSEUM);

	w.field("here", 1);
	w.field("name", home ? "Your home" : info.name);
	w.field("owner", home || museum ? "" : owner.name);
	w.field("home", home ? 1 : 0);
	w.field("museum", museum ? 1 : 0);
	w.field("buys", home || museum || shop_buys_anything(info.name) ? 1 : 0);
	w.field("noSelling", options->no_selling ? 1 : 0);
	w.field("gold", p_ptr->au);
	w.field("capacity", st->stock_size);

	w.key("actions").begin_array();
	for (auto const idx : info.actions)
	{
		if (idx >= ba_info.size() || !ba_info[idx].letter) continue;
		auto const &ba = ba_info[idx];
		w.begin_object();
		bool const liked = is_state(st, STORE_LIKED);
		int const state = liked ? STORE_LIKED : is_state(st, STORE_HATED) ? STORE_HATED : STORE_NORMAL;
		/* As bldg.cc's bldg_process_command: the price for how the keeper sees the hero, and actions kept from them. */
		bool const closed = (ba.action_restr == 1 && liked) || (ba.action_restr == 2 && !liked);
		w.field("key", std::string(1, ba.letter));
		w.field("action", ba.action);
		w.field("cost", ba.costs[state]);
		w.field("closed", closed ? 1 : 0);
		w.field("name", ba.name);
		w.end_object();
	}
	w.end_array();

	w.key("stock").begin_array();
	for (std::size_t i = 0; i < st->stock.size(); i++)
	{
		auto *o_ptr = &st->stock[i];
		char name[160];
		if (home || museum) object_desc(name, o_ptr, true, 3);
		else object_desc_store(name, o_ptr, true, 3);
		w.begin_object();
		w.field("i", i);
		w.field("name", name);
		w.field("tval", o_ptr->tval);
		w.field("number", o_ptr->number);
		w.field("weight", o_ptr->weight);
		w.field("ch", static_cast<unsigned char>(object_char(o_ptr)));
		w.field("attr", object_attr(o_ptr));
		auto const one = one_of(o_ptr);
		w.field("price", home || museum ? 0 : shop_price(*st, owner, &one, true));
		w.end_object();
	}
	w.end_array();

	w.key("sell").begin_array();
	for (int i = 0; i < INVEN_TOTAL; i++)
	{
		if (i == INVEN_PACK) i = INVEN_WIELD;
		object_type const *o_ptr = &p_ptr->inventory[i];
		if (!o_ptr->k_ptr) continue;
		char const *why = "";
		bool const takes = home || museum || shop_buys(info.name, o_ptr);
		if (!takes) why = "kind";
		else if (!home && !museum && object_value(o_ptr) <= 0) why = "worthless";
		else if (cursed_p(o_ptr) && (i >= INVEN_WIELD || (object_flags(o_ptr) & TR_CURSE_NO_DROP))) why = "cursed";
		else if (auto const one = one_of(o_ptr); !shop_has_room(*st, home || museum, &one)) why = "full";
		long price = 0;
		if (!*why && !home && !museum)
		{
			auto const one = one_of(o_ptr);
			price = std::min<long>(shop_price(*st, owner, &one, false), owner.max_cost);
			if (price < 0)
			{
				why = "nothing";
				price = 0;
			}
		}
		w.begin_object();
		w.field("i", i);
		w.field("why", why);
		w.field("price", price);
		w.end_object();
	}
	w.end_array();
	w.end_object();
	return json.c_str();
}

/*
 * Returns the player's recall of a visible monster (or one on the hero's side, wherever it is) as JSON
 * {"name": ..., "text": [[attr, "text"], ...]}.
 */
EMSCRIPTEN_KEEPALIVE char const *web_monster_desc(int m_idx)
{
	auto w = start_json();
	w.begin_object();

	if (!(level_ready()) || m_idx <= 0 || m_idx >= m_max)
	{
		w.end_object();
		return json.c_str();
	}

	monster_type const *m_ptr = &m_list[m_idx];
	if (!m_ptr->r_idx || (!m_ptr->ml && m_ptr->status < MSTATUS_FRIEND))
	{
		w.end_object();
		return json.c_str();
	}

	char name[160];
	monster_desc(name, m_ptr, 0x88);

	w.field("name", name);
	json_runs(w, "text", text_out_runs([m_ptr] { monster_description_out(m_ptr->r_idx, m_ptr->ego); }));
	w.end_object();
	return json.c_str();
}

/* The hero's recall of a creature race ({name, text: runs}), as its card shows it for one in view. */
EMSCRIPTEN_KEEPALIVE char const *web_race_recall(int r_idx)
{
	auto w = start_json();
	w.begin_object();
	auto const &r_info = game->edit_data.r_info;
	if (level_ready() && r_idx > 0 && static_cast<std::size_t>(r_idx) < r_info.size())
	{
		w.field("name", r_info[r_idx].name ? r_info[r_idx].name : "");
		json_runs(w, "text", text_out_runs([r_idx] { monster_description_out(r_idx, 0); }));
	}
	w.end_object();
	return json.c_str();
}

/*
 * The hero's quest log: every fixed quest taken, done or failed (json_quests),
 * and the random quests of the main dungeons done so far, with this level's
 * own while it is under way, by depth.
 */
EMSCRIPTEN_KEEPALIVE char const *web_quests_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();

	json_quests(w, true);

	w.key("random").begin_array();
	for (int depth = 1; depth < MAX_RANDOM_QUEST; depth++)
	{
		auto const &rq = random_quests[depth];
		if (!rq.type) continue;
		if (!rq.done && !(depth == dun_level && level_quest() == QUEST_RANDOM)) continue;
		w.begin_object();
		w.field("depth", depth);
		json_random_quest(w, depth);
		w.end_object();
	}
	w.end_array();

	w.end_object();
	return json.c_str();
}

/*
 * Returns where the player is, for the soundtrack: dungeon, town, quest,
 * wilderness terrain, time of day and how far the main story has come.
 */
EMSCRIPTEN_KEEPALIVE char const *web_place_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();

	auto const &d_info = game->edit_data.d_info;
	auto const &wf_info = game->edit_data.wf_info;
	auto const &wilderness = game->wilderness;

	w.field("dungeon", dungeon_type);
	w.field("dungeonName", d_info[dungeon_type].name);
	w.field("depth", dun_level);
	w.field("maxDepth", d_info[dungeon_type].maxdepth);
	w.field("wild", p_ptr->wild_mode ? 1 : 0);
	w.field("wx", p_ptr->wilderness_x);
	w.field("wy", p_ptr->wilderness_y);

	/* Fixed at birth: tells apart heroes who share a name. */
	std::uint8_t seed_bytes[seed_t::n_bytes];
	seed_flavor().to_bytes(seed_bytes);
	int32_t const hero_id = static_cast<int32_t>(seed_bytes[0] | (seed_bytes[1] << 8) | (seed_bytes[2] << 16) | (static_cast<uint32_t>(seed_bytes[3]) << 24));
	w.field("heroId", hero_id);
	w.field("kept", dun_level > 0 && get_dungeon_save_extension() ? 1 : 0);

	/* tome2 keeps town_num from the last surface area, so dungeon towns come from the dungeon's own list. */
	int town = 0;
	if (dun_level)
	{
		auto const &d_ptr = d_info[dungeon_type];
		for (int i = 0; i < d_ptr.t_num && i < TOWN_DUNGEON; i++)
		{
			if (d_ptr.t_level[i] == dun_level) town = d_ptr.t_idx[i];
		}
	}
	else if (!p_ptr->wild_mode && p_ptr->town_num > 0 && p_ptr->town_num < 1000)
	{
		town = p_ptr->town_num;
	}
	w.field("town", town);
	w.field("townDestroyed", (town > 0 && town_info && town_info[town].destroyed) ? 1 : 0);
	w.field("quest", p_ptr->inside_quest);
	w.field("levelQuest", level_quest_open() ? level_quest() : 0);

	auto const level_name = get_dungeon_name();
	w.field("levelName", level_name ? *level_name : std::string());

	std::string terrain;
	if (p_ptr->wilderness_x >= 0 && p_ptr->wilderness_y >= 0 &&
	    static_cast<std::size_t>(p_ptr->wilderness_x) < wilderness.width() &&
	    static_cast<std::size_t>(p_ptr->wilderness_y) < wilderness.height())
	{
		auto const feat = wilderness(p_ptr->wilderness_x, p_ptr->wilderness_y).feat;
		if (feat >= 0 && static_cast<std::size_t>(feat) < wf_info.size() && wf_info[feat].name) terrain = wf_info[feat].name;
	}
	while (!terrain.empty() && terrain.back() == ' ') terrain.pop_back();
	w.field("terrain", terrain);

	w.field("night", (turn % (10L * DAY)) < ((10L * DAY) / 2) ? 0 : 1);

	auto const done = [](int q) {
		auto const status = quest[q].status;
		return status == QUEST_STATUS_COMPLETED || status == QUEST_STATUS_REWARDED || status == QUEST_STATUS_FINISHED;
	};
	int stage = 0;
	if (done(QUEST_NECRO)) stage = 1;
	if (done(QUEST_SAURON)) stage = 2;
	if (done(QUEST_MORGOTH)) stage = 3;
	w.field("stage", stage);
	w.field("lev", p_ptr->lev);
	w.end_object();

	return json.c_str();
}

/*
 * Returns the character summary shown on the web character sheet.
 */
EMSCRIPTEN_KEEPALIVE char const *web_character_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();

	w.key("stats").begin_array();
	for (int i = 0; i < 6; i++)
	{
		char use[32];
		char top[32];
		cnv_stat(p_ptr->stat_use[i], use);
		cnv_stat(p_ptr->stat_top[i], top);
		w.begin_object();
		w.field("name", stat_names[i]);
		w.field("use", use);
		w.field("top", top);
		w.field("drained", p_ptr->stat_cur[i] < p_ptr->stat_max[i] ? 1 : 0);
		w.end_object();
	}
	w.end_array();

	w.field("god", deity_info[p_ptr->pgod].name);
	w.field("exp", p_ptr->exp);
	w.field("nextExp", p_ptr->lev < PY_MAX_LEVEL ? static_cast<long>(player_exp[p_ptr->lev - 1]) * p_ptr->expfact / 100L : 0);
	w.field("toHit", p_ptr->dis_to_h);
	w.field("toDam", p_ptr->dis_to_d);
	w.field("ac", p_ptr->dis_ac);
	w.field("toAc", p_ptr->dis_to_a);
	w.field("blows", p_ptr->num_blow);
	w.field("shots", p_ptr->num_fire);
	w.field("infra", p_ptr->see_infra * 10);
	w.field("maxDepth", max_dlv[dungeon_type]);

	auto const &s_info = game->s_info;
	auto const &s_descriptors = game->edit_data.s_descriptors;
	w.key("skills").begin_array();
	for (std::size_t i = 0; i < s_info.size() && i < s_descriptors.size(); i++)
	{
		if (s_info[i].hidden || s_info[i].value == 0 || s_descriptors[i].name.empty()) continue;
		w.begin_object();
		w.field("name", s_descriptors[i].name);
		w.field("value", s_info[i].value);
		w.field("mod", s_info[i].mod);
		w.end_object();
	}
	w.end_array();

	auto const &ab_info = game->edit_data.ab_info;
	w.key("abilities").begin_array();
	for (auto const ability : p_ptr->abilities)
	{
		if (ability < ab_info.size()) w.value(ab_info[ability].name);
	}
	w.end_array();

	w.field("turn", turn);
	w.end_object();

	return json.c_str();
}

/*
 * Returns the Hall of Fame (the scores file) as JSON, best first, with each
 * entry's deaths returned from and its mode.
 */
EMSCRIPTEN_KEEPALIVE char const *web_scores_json()
{
	auto const &race_info = game->edit_data.race_info;
	auto const &race_mod_info = game->edit_data.race_mod_info;
	auto const &class_info = game->edit_data.class_info;

	auto w = start_json();
	w.begin_array();

	char buf[1024];
	path_build(buf, sizeof(buf), ANGBAND_DIR_USER, "scores.raw");
	int fd = fd_open(buf, O_RDONLY);
	if (fd < 0)
	{
		w.end_array();
		return json.c_str();
	}

	auto field = [](char const *text, std::size_t size) {
		std::string value(text, strnlen(text, size));
		auto const start = value.find_first_not_of(' ');
		auto const end = value.find_last_not_of(' ');
		return start == std::string::npos ? std::string() : value.substr(start, end - start + 1);
	};

	high_score score;
	for (int i = 0; i < MAX_HISCORES; i++)
	{
		if (highscore_seek(fd, i) || highscore_read(fd, &score)) break;

		int const pr = atoi(score.p_r);
		int const ps = atoi(score.p_s);
		int const pc = atoi(score.p_c);
		int const pcs = atoi(score.p_cs);
		std::string race;
		if (pr >= 0 && static_cast<std::size_t>(pr) < race_info.size() &&
		    ps >= 0 && static_cast<std::size_t>(ps) < race_mod_info.size())
		{
			race = get_player_race_name(pr, ps);
		}
		std::string cls;
		if (pc >= 0 && static_cast<std::size_t>(pc) < class_info.size() &&
		    pcs >= 0 && static_cast<std::size_t>(pcs) < class_info[pc].spec.size() &&
		    class_info[pc].spec[pcs].title)
		{
			cls = class_info[pc].spec[pcs].title;
		}

		w.begin_object();
		w.field("name", field(score.who, sizeof(score.who)));
		w.field("race", race);
		w.field("cls", cls);
		w.field("points", atol(score.pts));
		/* engine/adventure.cc keeps the deaths and the mode in fields tome2 leaves unused. */
		w.field("deaths", atoi(field(score.unused_2, sizeof(score.unused_2)).c_str()));
		w.field("adventure", atoi(field(score.unused_3, sizeof(score.unused_3)).c_str()));
		w.field("gold", atol(score.gold));
		w.field("turns", atol(score.turns));
		w.field("day", field(score.day, sizeof(score.day)));
		w.field("level", atoi(score.cur_lev));
		w.field("maxLevel", atoi(score.max_lev));
		w.field("depth", atoi(score.cur_dun));
		w.field("maxDepth", atoi(score.max_dun));
		w.field("quest", atoi(score.inside_quest) ? 1 : 0);
		w.field("how", field(score.how, sizeof(score.how)));
		w.end_object();
	}
	fd_close(fd);

	w.end_array();
	return json.c_str();
}

/*
 * Records a run the player gave up through tome2's quit command as
 * abandoned, so the Hall of Fame keeps it: tome2 registers no score for
 * "Quitting". Only between that quit and the score being written (not for a
 * winner retiring); false otherwise.
 */
EMSCRIPTEN_KEEPALIVE int web_mark_abandoned()
{
	if (!death || total_winner || game->died_from != "Quitting") return 0;
	game->died_from = "Abandoned";
	return 1;
}

/*
 * Removes one entry (by its place in web_scores_json) from the Hall of
 * Fame. False when there is no such entry or the file cannot be written.
 */
EMSCRIPTEN_KEEPALIVE int web_remove_score(int index)
{
	char buf[1024];
	path_build(buf, sizeof(buf), ANGBAND_DIR_USER, "scores.raw");
	int fd = fd_open(buf, O_RDONLY);
	if (fd < 0) return 0;
	std::vector<high_score> scores;
	high_score score;
	for (int i = 0; i < MAX_HISCORES; i++)
	{
		if (highscore_seek(fd, i) || highscore_read(fd, &score)) break;
		scores.push_back(score);
	}
	fd_close(fd);
	if (index < 0 || static_cast<std::size_t>(index) >= scores.size()) return 0;
	scores.erase(scores.begin() + index);

	FILE *out = fopen(buf, "wb");
	if (!out) return 0;
	bool const written = scores.empty() || fwrite(scores.data(), sizeof(high_score), scores.size(), out) == scores.size();
	return (fclose(out) == 0 && written) ? 1 : 0;
}

/* A kind of object's name without tome2's article and plural marks ("Holy Tome of Eru Iluvatar"). */
static std::string kind_name(int tval, int sval)
{
	auto const &k_info = game->edit_data.k_info;
	auto const k_idx = lookup_kind(tval, sval);
	if (!k_idx) return "";
	std::string name;
	for (char ch : k_info.at(k_idx)->name)
	{
		if (ch != '&' && ch != '~') name += ch;
	}
	auto const start = name.find_first_not_of(' ');
	return start == std::string::npos ? "" : name.substr(start);
}

/*
 * The gods of this module: name, the altar raised to them, and the tome of
 * their prayers with each prayer (name, skill level, description).
 */
static void json_gods(JsonWriter &w)
{
	auto const &f_info = game->edit_data.f_info;
	w.key("gods").begin_array();
	for (int g = 1; g < MAX_GODS; g++)
	{
		deity_type &god = deity_info[g];
		if (!god_enabled(&god)) continue;
		w.begin_object();
		w.field("name", god.name);
		int const altar = FEAT_ALTAR_HEAD + g - 1;
		if (altar <= FEAT_ALTAR_TAIL && static_cast<std::size_t>(altar) < f_info.size()) w.field("altar", f_info[altar].name);
		for (int sval = 0; sval < SCHOOL_BOOKS_SIZE; sval++)
		{
			school_book *sb = school_books_at(sval);
			if (!sb || sb->spell_idxs.empty()) continue;
			bool const ours = std::all_of(sb->spell_idxs.begin(), sb->spell_idxs.end(), [&](s32b idx) { return spell_god(spell_at(idx)) == &god; });
			if (!ours) continue;
			w.field("book", kind_name(TV_BOOK, sval));
			w.key("prayers").begin_array();
			for (auto spell_idx : sb->spell_idxs)
			{
				spell_type *spell = spell_at(spell_idx);
				w.begin_object();
				w.field("name", spell_type_name(spell));
				w.field("skill", spell_type_skill_level(spell));
				w.field("desc", spell_description(spell));
				w.end_object();
			}
			w.end_array();
			break;
		}
		w.end_object();
	}
	w.end_array();
}

/*
 * Returns what character creation offers: every race, race modifier and
 * class (with specialisations), with stat adjustments, skills, abilities
 * and intrinsics, for the native birth screens.
 */
EMSCRIPTEN_KEEPALIVE char const *web_birth_json()
{
	auto const &race_info = game->edit_data.race_info;
	auto const &race_mod_info = game->edit_data.race_mod_info;
	auto const &class_info = game->edit_data.class_info;

	auto w = start_json();
	w.begin_object();
	w.key("races").begin_array();
	for (std::size_t i = 0; i < race_info.size(); i++)
	{
		auto const &r = race_info[i];
		w.begin_object();
		w.field("title", r.title);
		w.field("desc", r.desc);
		json_shared(w, r.ps);
		w.field("luck", r.luck);
		w.field("infra", r.infra);
		json_race_flags(w, r.flags);
		json_level_flags(w, r.lflags);
		json_skill_mods(w, r.skill_modifiers);
		json_abilities(w, r.abilities);
		json_bit_names(w, "classes", r.choice, [&](std::size_t c) { return c < class_info.size() ? class_info[c].title : std::string(); }, class_info.size());
		w.field("index", i);
		w.end_object();
	}
	w.end_array();
	w.key("mods").begin_array();
	for (std::size_t i = 0; i < race_mod_info.size(); i++)
	{
		auto const &m = race_mod_info[i];
		w.begin_object();
		w.field("title", m.title);
		w.field("desc", m.description);
		json_shared(w, m.ps);
		w.field("luck", m.luck);
		w.field("infra", m.infra);
		w.field("mana", m.mana);
		json_race_flags(w, m.flags);
		json_level_flags(w, m.lflags);
		json_skill_mods(w, m.skill_modifiers);
		json_abilities(w, m.abilities);
		w.field("index", i);
		w.end_object();
	}
	w.end_array();
	w.key("classes").begin_array();
	for (std::size_t i = 0; i < class_info.size(); i++)
	{
		auto const &c = class_info[i];
		w.begin_object();
		w.field("title", c.title);
		w.field("desc", c.desc);
		json_shared(w, c.ps);
		w.field("mana", c.mana);
		w.field("blows", c.blow_num);
		w.field("extraBlows", c.extra_blows);
		json_race_flags(w, c.flags);
		json_level_flags(w, c.lflags);
		json_skill_mods(w, c.skill_modifiers);
		json_abilities(w, c.abilities);
		w.key("specs").begin_array();
		for (std::size_t j = 0; j < c.spec.size(); j++)
		{
			auto const &sp = c.spec[j];
			w.begin_object();
			w.field("title", sp.title ? sp.title : "");
			w.field("desc", sp.desc ? sp.desc : "");
			json_race_flags(w, sp.flags);
			json_skill_mods(w, sp.skill_modifiers);
			json_abilities(w, sp.abilities);
			w.key("gods").begin_array();
			for (int g = 0; g < MAX_GODS; g++)
			{
				if (((c.gods | sp.gods) & BIT(g)) && god_enabled(&deity_info[g])) w.value(deity_info[g].name);
			}
			w.end_array();
			w.field("index", j);
			w.end_object();
		}
		w.end_array();
		w.field("index", i);
		w.end_object();
	}
	w.end_array();
	json_gods(w);
	w.end_object();
	return json.c_str();
}

/*
 * Where a power of the hero's comes from, as tome2's calc_powers grants it:
 * their class, race or race modifier (in their own body), something worn,
 * a corruption, the form they have taken, or something else (a mushroom's
 * gift, a possessor's way back to a body); with its name ("Hobbit", the item).
 */
static std::pair<std::string, std::string> power_source(int idx)
{
	auto grants = [idx](auto const &powers) {
		return std::find(std::begin(powers), std::end(powers), idx) != std::end(powers);
	};
	bool const own_body = !p_ptr->tim_mimic && !p_ptr->body_monster;
	/* Vampiric teeth grant their power through a copy of the hero's race modifier (player_gain_vampire_teeth). */
	if (idx == PWR_VAMPIRISM && player_has_corruption(CORRUPT_VAMPIRE_TEETH)) return { "corruption", "" };
	if (cp_ptr && grants(cp_ptr->ps.powers)) return { "class", cp_ptr->title };
	if (own_body && rp_ptr && grants(rp_ptr->ps.powers)) return { "race", rp_ptr->title };
	if (own_body && rmp_ptr && grants(rmp_ptr->ps.powers)) return { "race", rmp_ptr->title };
	for (int i = INVEN_WIELD; i < INVEN_TOTAL; i++)
	{
		object_type *o_ptr = &p_ptr->inventory[i];
		if (!o_ptr->k_ptr || object_power(o_ptr) != idx) continue;
		char name[160];
		object_desc(name, o_ptr, true, 0);
		return { "gear", name };
	}
	for (int i = 0; i < CORRUPTIONS_MAX; i++)
	{
		if (player_has_corruption(i) && get_corruption_power(i) == idx) return { "corruption", "" };
	}
	if (p_ptr->mimic_form) return { "form", get_mimic_name(p_ptr->mimic_form) };
	return { "other", "" };
}

/*
 * The chance in a hundred that activating an item or zapping a rod of level
 * `lev` fails, as do_cmd_activate and do_cmd_zap_rod roll it: the hero's
 * device skill (halved while confused) less the level (at most 50), at least
 * 1, ten times that for an easy one; below USE_DEVICE a slight chance still.
 */
static int device_fail(int lev, object_flag_set const &flags)
{
	int chance = p_ptr->skill_dev;
	if (p_ptr->confused) chance /= 2;
	chance -= std::min(lev, 50);
	if (chance <= 0) chance = 1;
	if (flags & TR_EASY_USE) chance *= 10;
	double const ok = chance < USE_DEVICE ? 1.0 / ((USE_DEVICE - chance + 1) * USE_DEVICE) : static_cast<double>(chance - USE_DEVICE + 1) / chance;
	return static_cast<int>(std::lround(100 * (1 - ok)));
}

/* The level do_cmd_activate tests an item's activation against: its kind's, or its artifact's. */
static int activation_level(object_type const *o_ptr)
{
	if (!artifact_p(o_ptr)) return o_ptr->k_ptr->level;
	if (o_ptr->tval == TV_RANDART) return game->random_artifacts[o_ptr->sval].level;
	return game->edit_data.a_info[o_ptr->name1].level;
}

/* An entry of "items": one way the hero can use the item at inventory index `i`, by its command. */
static void json_item_use(JsonWriter &w, int i, object_type const *o_ptr, char const *command)
{
	w.field("i", i);
	w.field("base", base_name(o_ptr));
	w.field("tval", o_ptr->tval);
	w.field("sval", o_ptr->sval);
	w.field("command", command);
}

/*
 * The items the hero can use as magic (see web_spells_json): those known to
 * activate (but eggs, whose activation stops or resumes their hatching),
 * worn or carried (`wear` when tome2 would ask for it to be worn
 * first; `effect` tome2's activation text; `charging` while it recharges,
 * as tome2's "(charging)"), and the wands, staffs and rods carried
 * (`charges` of a known wand or staff; `charging` for a known rod without
 * the mana for its tip yet). `fail` is the chance in a hundred of failing,
 * as tome2 rolls it now.
 */
static void json_magic_items(JsonWriter &w)
{
	auto const &k_info = game->edit_data.k_info;
	w.key("items").begin_array();
	for (int i = 0; i < INVEN_TOTAL; i++)
	{
		object_type *o_ptr = &p_ptr->inventory[i];
		if (i == INVEN_PACK || !o_ptr->k_ptr) continue;
		auto const flags = object_flags(o_ptr);
		bool const known = object_known_p(o_ptr);
		int const how = o_ptr->tval == TV_EGG ? 0 : activates(o_ptr, flags);
		if (how)
		{
			w.begin_object();
			json_item_use(w, i, o_ptr, "A");
			w.field("effect", item_activation(o_ptr));
			if (o_ptr->timeout) w.field("charging", 1);
			if (i < INVEN_WIELD && how == 1) w.field("wear", 1);
			w.field("fail", device_fail(activation_level(o_ptr), flags));
			w.end_object();
		}
		if (i >= INVEN_WIELD) continue;
		if (o_ptr->tval == TV_WAND || o_ptr->tval == TV_STAFF)
		{
			w.begin_object();
			json_item_use(w, i, o_ptr, o_ptr->tval == TV_WAND ? "a" : "u");
			if (known)
			{
				w.field("charges", o_ptr->pval);
				stick_mode_of const device(o_ptr);
				int chance = spell_chance_device(spell_at(o_ptr->pval2));
				if (flags & TR_EASY_USE) chance /= 3;
				w.field("fail", chance);
			}
			w.end_object();
		}
		else if (o_ptr->tval == TV_ROD_MAIN && o_ptr->pval != SV_ROD_NOTHING)
		{
			w.begin_object();
			json_item_use(w, i, o_ptr, "z");
			if (known)
			{
				auto const &tip = k_info.at(lookup_kind(TV_ROD, o_ptr->pval));
				int const cost = (flags & TR_CHEAPNESS) ? tip->pval / 2 : tip->pval;
				if (o_ptr->timeout < cost) w.field("charging", 1);
				w.field("fail", device_fail(tip->level, flags));
			}
			w.end_object();
		}
	}
	w.end_array();
}

/*
 * Returns the spells the player can see in the books and spell-holding
 * items carried (as tome2's spell lists show them), the skills and
 * abilities that can be activated, in the order of tome2's menu, tome2's
 * powers, and the items used as magic (json_magic_items).
 */
EMSCRIPTEN_KEEPALIVE char const *web_spells_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();
	stick_mode_kept const kept;
	w.key("books").begin_array();
	for (int i = 0; i < INVEN_TOTAL; i++)
	{
		object_type *o_ptr = &p_ptr->inventory[i];
		if (!o_ptr->k_ptr) continue;
		int sval;
		s32b pval;
		if (!spell_book_of(o_ptr, &sval, &pval)) continue;
		if ((wield_slot(o_ptr) != -1) && (i < INVEN_WIELD) && (object_flags(o_ptr) & TR_WIELD_CAST)) continue;
		random_book_setup(sval, pval);
		school_book *sb = school_books_at(sval);
		if (!sb) continue;

		char name[160];
		object_desc(name, o_ptr, true, 0);
		w.begin_object();
		w.field("i", i);
		w.field("name", name);
		w.key("spells").begin_array();
		for (auto spell_idx : sb->spell_idxs) json_spell(w, spell_idx, o_ptr->pval);
		w.end_array();
		w.end_object();
	}
	w.end_array();

	auto const &ab_info = game->edit_data.ab_info;
	auto const &s_descriptors = game->edit_data.s_descriptors;
	auto const &s_info = game->s_info;
	std::vector<std::pair<std::string, int>> menu;
	if (get_melee_skills() > 1) menu.emplace_back("Change melee mode", 0);
	auto seen = [&](int mkey) {
		for (auto const &e : menu)
		{
			if (e.second == mkey) return true;
		}
		return false;
	};
	for (std::size_t i = 1; i < s_descriptors.size() && i < s_info.size(); i++)
	{
		if (s_descriptors[i].action_mkey && s_info[i].value && ((!s_info[i].hidden) || (i == SKILL_LEARN)) && !seen(s_descriptors[i].action_mkey))
		{
			menu.emplace_back(s_descriptors[i].action_desc, s_descriptors[i].action_mkey);
		}
	}
	for (std::size_t i = 0; i < ab_info.size(); i++)
	{
		if (ab_info[i].action_mkey && p_ptr->has_ability(i) && !seen(ab_info[i].action_mkey))
		{
			menu.emplace_back(ab_info[i].action_desc, ab_info[i].action_mkey);
		}
	}
	w.key("bonus").begin_array();
	std::vector<int> power_idxs(std::begin(p_ptr->powers), std::end(p_ptr->powers));
	std::sort(std::begin(power_idxs), std::end(power_idxs));
	for (auto const idx : power_idxs)
	{
		auto it = game->powers.find(idx);
		if (it == game->powers.end()) continue;
		auto const [source, from] = power_source(idx);
		w.begin_object();
		w.field("name", it->second->name);
		w.field("desc", it->second->desc_text);
		w.field("source", source);
		w.field("from", from);
		w.field("level", it->second->activation.level);
		w.field("cost", it->second->activation.cost);
		w.field("stat", it->second->activation.stat);
		w.field("diff", it->second->activation.diff);
		w.end_object();
	}
	w.end_array();
	w.key("powers").begin_array();
	for (auto const &[label, mkey] : menu)
	{
		w.begin_object();
		w.field("label", label);
		w.field("mkey", mkey);
		w.end_object();
	}
	w.end_array();
	json_magic_items(w);
	w.end_object();
	return json.c_str();
}

/*
 * Returns the skills screen's whole list (tome2 shows only a window of it),
 * in its order: [{name, depth, branch, value, mod, state, raise, desc}], with
 * the points left and the highest level a skill may be raised to now (`most`).
 * branch: 0 none, 1 closed, 2 open. raise: why tome2's increase_skill would
 * refuse a point ("points", "fixed", "max", "level"), empty when it would take
 * one. Values are the ones the screen shows while points are being moved.
 */
EMSCRIPTEN_KEEPALIVE char const *web_skills_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();

	auto const &s_descriptors = game->edit_data.s_descriptors;
	auto const &s_info = game->s_info;
	std::size_t const n = std::min(s_descriptors.size(), s_info.size());

	std::function<bool(std::size_t)> known = [&](std::size_t s_idx) -> bool {
		if (wizard) return true;
		if (s_info[s_idx].value || s_info[s_idx].mod) return true;
		for (std::size_t i = 0; i < n; i++)
		{
			if (s_descriptors[i].father == static_cast<int>(s_idx) && known(i)) return true;
		}
		return false;
	};
	auto has_child = [&](std::size_t s_idx) {
		for (std::size_t i = 1; i < n; i++)
		{
			if (s_descriptors[i].father == static_cast<int>(s_idx) && known(i)) return true;
		}
		return false;
	};
	auto by_order = [&](std::size_t order) -> std::size_t {
		for (std::size_t j = 1; j < n; j++)
		{
			if (s_descriptors[j].order == static_cast<int>(order)) return j;
		}
		return 0;
	};

	s32b const most = p_ptr->lev + modules[game_module_idx].skills.max_skill_overage;
	auto refusal = [&](std::size_t i) -> char const * {
		auto const &skill = s_info[i];
		if (i == SKILL_MISC || !skill.mod) return "fixed";
		if (skill.value >= SKILL_MAX) return "max";
		if ((skill.value + skill.mod) / SKILL_STEP >= most + 1) return "level";
		if (!p_ptr->skill_points) return "points";
		return "";
	};

	w.field("points", p_ptr->skill_points);
	w.field("most", most);
	w.key("skills").begin_array();
	std::function<void(int, int)> add = [&](int father, int depth) {
		for (std::size_t j = 1; j < n; j++)
		{
			std::size_t const i = by_order(j);
			if (s_descriptors[i].father != father) continue;
			if (s_info[i].hidden) continue;
			if (!known(i)) continue;
			auto const &skill = s_info[i];
			char const *state = "normal";
			if (skill.value == 0 && i != SKILL_MISC) state = skill.mod == 0 ? "untrained" : "learnable";
			else if (skill.value == SKILL_MAX) state = "max";
			w.begin_object();
			w.field("name", s_descriptors[i].name);
			w.field("depth", depth);
			w.field("branch", has_child(i) ? (skill.dev ? 2 : 1) : 0);
			w.field("value", skill.value);
			w.field("mod", skill.mod);
			w.field("state", state);
			w.field("misc", i == SKILL_MISC ? 1 : 0);
			w.field("raise", refusal(i));
			w.field("desc", s_descriptors[i].desc);
			w.end_object();
			if (skill.dev) add(static_cast<int>(i), depth + 1);
		}
	};
	add(-1, 0);
	w.end_array();
	w.end_object();
	return json.c_str();
}

/*
 * Returns the abilities screen's whole list, sorted by name as tome2 does:
 * [{name, cost, known, learnable, desc, needs: [text]}], with the points left.
 */
EMSCRIPTEN_KEEPALIVE char const *web_abilities_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();

	auto const &ab_info = game->edit_data.ab_info;
	auto const &s_descriptors = game->edit_data.s_descriptors;

	std::vector<std::size_t> table;
	for (std::size_t i = 0; i < ab_info.size(); i++)
	{
		if (!ab_info[i].name.empty()) table.push_back(i);
	}
	std::sort(table.begin(), table.end(), [&](std::size_t a, std::size_t b) { return ab_info[a].name < ab_info[b].name; });

	w.field("points", p_ptr->skill_points);
	w.key("abilities").begin_array();
	for (auto const i : table)
	{
		auto const &ab = ab_info[i];
		bool const known = p_ptr->has_ability(i);
		bool met = true;
		std::vector<std::string> needs;
		for (auto const &need : ab.need_skills)
		{
			if (need.skill_idx < 0 || static_cast<std::size_t>(need.skill_idx) >= s_descriptors.size()) continue;
			needs.push_back(s_descriptors[need.skill_idx].name + " " + std::to_string(need.level));
			if (get_skill(need.skill_idx) < need.level) met = false;
		}
		for (auto const need : ab.need_abilities)
		{
			if (need < 0 || static_cast<std::size_t>(need) >= ab_info.size()) continue;
			needs.push_back(ab_info[need].name);
			if (!p_ptr->has_ability(need)) met = false;
		}
		for (int s = 0; s < 6; s++)
		{
			if (ab.stat[s] <= -1) continue;
			int const level = ab.stat[s];
			needs.push_back(std::string(stat_names[s]) + " " + (level <= 18 ? std::to_string(level) : "18/" + std::to_string((level - 18) * 10)));
			if (p_ptr->stat_ind[s] < level - 3) met = false;
		}
		w.begin_object();
		w.field("name", ab.name);
		w.field("cost", ab.cost);
		w.field("known", known ? 1 : 0);
		w.field("met", met ? 1 : 0);
		w.field("learnable", !known && met && p_ptr->skill_points >= ab.cost ? 1 : 0);
		w.field("desc", ab.desc);
		w.key("needs").begin_array();
		for (auto const &need : needs) w.value(need);
		w.end_array();
		w.end_object();
	}
	w.end_array();
	w.end_object();
	return json.c_str();
}

/*
 * While a tome2 screen covers the map: the screen as it was before the
 * first screen_save() (what the overlay is drawn over), as [width, height,
 * (attr << 8 | char)...]; null when nothing is saved.
 */
EMSCRIPTEN_KEEPALIVE int32_t const *web_saved_screen()
{
	static std::vector<int32_t> saved;
	if (!character_icky || !angband_term[0]) return nullptr;
	Term_with_active(angband_term[0], []() {
		int w = 0;
		int h = 0;
		Term_get_size(&w, &h);
		saved.assign(2 + static_cast<std::size_t>(w) * h, 0);
		saved[0] = w;
		saved[1] = h;
		term_win *current = Term_save_to();
		Term_load();
		for (int y = 0; y < h; y++)
		{
			for (int x = 0; x < w; x++)
			{
				byte a = 0;
				char c = 0;
				Term_what(x, y, &a, &c);
				saved[2 + y * w + x] = (static_cast<int32_t>(a) << 8) | static_cast<unsigned char>(c);
			}
		}
		Term_load_from(current);
	});
	return saved.data();
}

}
