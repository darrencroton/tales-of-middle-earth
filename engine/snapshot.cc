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
#include "cmd5.hpp"
#include "defines.hpp"
#include "dungeon_info_type.hpp"
#include "feature_flag.hpp"
#include "feature_type.hpp"
#include "game.hpp"
#include "hiscore.hpp"
#include "deity_type.hpp"
#include "inventory.hpp"
#include "levels.hpp"
#include "lua_bind.hpp"
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
#include "quest_type.hpp"
#include "school_book.hpp"
#include "school_type.hpp"
#include "seed.hpp"
#include "skill_descriptor.hpp"
#include "skills.hpp"
#include "skills_defs.hpp"
#include "spells1.hpp"
#include "spell_type.hpp"
#include "spells4.hpp"
#include "spells5.hpp"
#include "spells6.hpp"
#include "store_info_type.hpp"
#include "store_type.hpp"
#include "tables.hpp"
#include "town_type.hpp"
#include "util.hpp"
#include "variable.hpp"
#include "wilderness_map.hpp"
#include "wilderness_type_info.hpp"
#include "xtra1.hpp"
#include "z-term.hpp"

#include <boost/preprocessor/cat.hpp>

#include <emscripten.h>

#include <algorithm>
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

/* Map memory (engine/memory.cc). */
void web_memory_tick();
void web_run_options_tick();

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

/*
 * True once the character has a level, including while a new level is being
 * generated: quest hooks print messages (with -more-) before the engine marks
 * the dungeon ready, and the map must stay native through them.
 */
bool level_ready()
{
	return character_generated && cave && p_ptr;
}

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
std::string json;

int32_t ptr(void const *p)
{
	return static_cast<int32_t>(reinterpret_cast<uintptr_t>(p));
}

void json_string(std::string &out, std::string_view s)
{
	out += '"';
	for (unsigned char c : s)
	{
		switch (c)
		{
		case '"': out += "\\\""; break;
		case '\\': out += "\\\\"; break;
		case '\n': out += "\\n"; break;
		case '\r': out += "\\r"; break;
		case '\t': out += "\\t"; break;
		default:
			if (c < 0x20 || c >= 0x7f)
			{
				char buf[8];
				snprintf(buf, sizeof(buf), "\\u%04x", c);
				out += buf;
			}
			else
			{
				out += static_cast<char>(c);
			}
		}
	}
	out += '"';
}

void json_key(std::string &out, char const *key)
{
	json_string(out, key);
	out += ':';
}

void json_int(std::string &out, char const *key, long value, bool comma = true)
{
	json_key(out, key);
	out += std::to_string(value);
	if (comma) out += ',';
}

void json_str(std::string &out, char const *key, std::string_view value, bool comma = true)
{
	json_key(out, key);
	json_string(out, value);
	if (comma) out += ',';
}

void json_object(std::string &out, int index, object_type const *o_ptr)
{
	char name[160];
	object_desc(name, o_ptr, true, 3);
	auto const flags = object_flags(o_ptr);

	out += '{';
	json_int(out, "i", index);
	json_str(out, "name", name);
	json_int(out, "tval", o_ptr->tval);
	json_int(out, "sval", o_ptr->sval);
	json_int(out, "number", o_ptr->number);
	json_int(out, "weight", o_ptr->weight);
	json_int(out, "ch", static_cast<unsigned char>(object_char(o_ptr)));
	json_int(out, "attr", object_attr(o_ptr));
	json_int(out, "wear", wield_slot(o_ptr) >= 0 ? 1 : 0);
	json_int(out, "activate", (flags & TR_ACTIVATE) ? 1 : 0);
	json_str(out, "ins", o_ptr->inscription, false);
	out += '}';
}

/* text_out() hook collecting coloured runs as JSON [[attr, "text"], ...]. */
std::string text_runs;

void text_out_to_json(byte a, const char *str)
{
	if (!text_runs.empty()) text_runs += ',';
	text_runs += '[';
	text_runs += std::to_string(a);
	text_runs += ',';
	json_string(text_runs, str);
	text_runs += ']';
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

void json_race_flags(std::string &out, player_race_flag_set const &flags)
{
	json_key(out, "flags");
	out += '[';
	bool first = true;
	for (auto const &[flag, name] : race_flag_names())
	{
		if (!(flags & flag)) continue;
		if (!first) out += ',';
		first = false;
		json_string(out, name);
	}
	out += "],";
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

void json_skill_mods(std::string &out, skill_modifiers const &mods)
{
	auto const &s_descriptors = game->edit_data.s_descriptors;
	json_key(out, "skills");
	out += '[';
	bool first = true;
	for (std::size_t i = 0; i < mods.modifiers.size() && i < s_descriptors.size(); i++)
	{
		auto const &m = mods.modifiers[i];
		if ((m.base == 0 && m.mod == 0) || s_descriptors[i].name.empty()) continue;
		if (!first) out += ',';
		first = false;
		out += '{';
		json_str(out, "name", s_descriptors[i].name);
		json_str(out, "op", std::string(1, modifier_op(m.basem)));
		json_int(out, "base", static_cast<long>(m.base));
		json_str(out, "modOp", std::string(1, modifier_op(m.modm)));
		json_int(out, "mod", m.mod, false);
		out += '}';
	}
	out += "],";
}

void json_abilities(std::string &out, std::vector<player_race_ability_type> const &abilities)
{
	auto const &ab_info = game->edit_data.ab_info;
	json_key(out, "abilities");
	out += '[';
	bool first = true;
	for (auto const &a : abilities)
	{
		if (a.ability < 0 || static_cast<std::size_t>(a.ability) >= ab_info.size()) continue;
		if (!first) out += ',';
		first = false;
		out += '{';
		json_str(out, "name", ab_info[a.ability].name);
		json_str(out, "desc", ab_info[a.ability].desc);
		json_int(out, "level", a.level, false);
		out += '}';
	}
	out += "],";
}

void json_level_flags(std::string &out, std::array<player_level_flag, PY_MAX_LEVEL + 1> const &lflags)
{
	json_key(out, "levelFlags");
	out += '[';
	bool first = true;
	for (int lev = 0; lev <= PY_MAX_LEVEL; lev++)
	{
		auto const &lf = lflags[lev];
		if (!lf.oflags) continue;
		if (!first) out += ',';
		first = false;
		out += '{';
		json_int(out, "level", lev);
		json_int(out, "pval", lf.pval);
		json_key(out, "flags");
		out += '[';
		bool firstFlag = true;
		for (auto const meta : object_flags_meta())
		{
			if (!(lf.oflags & meta->flag_set)) continue;
			if (!firstFlag) out += ',';
			firstFlag = false;
			json_string(out, meta->e_name);
		}
		out += "]}";
	}
	out += "],";
}

void json_shared(std::string &out, player_shared const &ps)
{
	json_key(out, "stats");
	out += '[';
	for (int i = 0; i < 6; i++)
	{
		if (i) out += ',';
		out += std::to_string(ps.adj[i]);
	}
	out += "],";
	json_int(out, "hitDie", ps.mhp);
	json_int(out, "exp", ps.exp);
	json_key(out, "powers");
	out += '[';
	bool first = true;
	for (auto const p : ps.powers)
	{
		auto it = game->powers.find(p);
		if (it == game->powers.end()) continue;
		if (!first) out += ',';
		first = false;
		out += '{';
		json_str(out, "name", it->second->name);
		json_str(out, "desc", it->second->desc_text, false);
		out += '}';
	}
	out += "],";
}

void json_bit_names(std::string &out, char const *key, std::array<u32b, 2> const &bits, std::function<std::string(std::size_t)> name, std::size_t count)
{
	json_key(out, key);
	out += '[';
	bool first = true;
	for (std::size_t i = 0; i < count && i < 64; i++)
	{
		if (!(bits[i / 32] & (1u << (i % 32)))) continue;
		if (!first) out += ',';
		first = false;
		json_string(out, name(i));
	}
	out += "],";
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

}

extern "C" {

/*
 * Rebuilds the level arrays and returns the header (see HeaderSlot).
 */
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

EMSCRIPTEN_KEEPALIVE int32_t const *web_snapshot()
{
	auto const &f_info = game->edit_data.f_info;

	bool const ready = level_ready();

	if (auto_more_override >= 0 && options) options->auto_more = auto_more_override != 0;
	if (delay_override >= 0 && options) options->delay_factor = delay_override;
	web_memory_tick();
	web_run_options_tick();

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
 * Returns the terrain feature table as JSON: [{name, ch, attr, flags}, ...].
 */
EMSCRIPTEN_KEEPALIVE char const *web_features_json()
{
	auto const &f_info = game->edit_data.f_info;

	json.clear();
	json += '[';

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

		if (i) json += ',';
		json += '{';
		json_str(json, "name", f.name);
		json_int(json, "ch", static_cast<unsigned char>(f.x_char));
		json_int(json, "attr", f.x_attr);
		json_int(json, "flags", bits, false);
		json += '}';
	}

	json += ']';
	return json.c_str();
}

/*
 * Returns player, visible monster/object and recent message state as JSON.
 */
EMSCRIPTEN_KEEPALIVE char const *web_state_json(int max_messages)
{
	json.clear();
	json += '{';

	if (!(level_ready()))
	{
		json_int(json, "ready", 0, false);
		json += '}';
		return json.c_str();
	}

	json_int(json, "ready", 1);

	/* Player */
	json_key(json, "player");
	json += '{';
	json_str(json, "name", game->player_name);
	json_str(json, "race", rp_ptr ? rp_ptr->title : "");
	json_str(json, "cls", spp_ptr ? spp_ptr->title : (cp_ptr ? cp_ptr->title : ""));
	if (cp_ptr && p_ptr->lev >= 1)
	{
		std::size_t idx = static_cast<std::size_t>((p_ptr->lev - 1) / 5);
		if (idx < cp_ptr->titles.size()) json_str(json, "title", cp_ptr->titles[idx]);
	}
	json_int(json, "lev", p_ptr->lev);
	json_int(json, "exp", p_ptr->exp);
	json_int(json, "au", p_ptr->au);
	json_int(json, "chp", p_ptr->chp);
	json_int(json, "mhp", p_ptr->mhp);
	json_int(json, "csp", p_ptr->csp);
	json_int(json, "msp", p_ptr->msp);
	json_int(json, "csane", p_ptr->csane);
	json_int(json, "msane", p_ptr->msane);
	json_int(json, "speed", p_ptr->pspeed - 110);
	json_int(json, "food", p_ptr->food);
	json_int(json, "depth", dun_level);
	json_str(json, "dungeon", game->edit_data.d_info[dungeon_type].name);
	json_int(json, "wild", p_ptr->wild_mode ? 1 : 0);
	json_int(json, "alwaysPickup", options->always_pickup ? 1 : 0);
	json_int(json, "skillPoints", p_ptr->skill_points);
	json_int(json, "dead", death ? 1 : 0);
	json_str(json, "diedFrom", game->died_from);
	json_key(json, "status");
	json += '{';
	json_int(json, "blind", p_ptr->blind);
	json_int(json, "confused", p_ptr->confused);
	json_int(json, "afraid", p_ptr->afraid);
	json_int(json, "poisoned", p_ptr->poisoned);
	json_int(json, "paralyzed", p_ptr->paralyzed);
	json_int(json, "hallucinating", p_ptr->image);
	json_int(json, "cut", p_ptr->cut);
	json_int(json, "stun", p_ptr->stun);
	json_int(json, "fast", p_ptr->fast);
	json_int(json, "slow", p_ptr->slow, false);
	json += "}},";

	/* Visible monsters */
	json_key(json, "monsters");
	json += '[';
	bool first = true;
	for (int i = 1; i < m_max; i++)
	{
		monster_type const *m_ptr = &m_list[i];

		if (!m_ptr->r_idx || !m_ptr->ml) continue;

		auto r_ptr = m_ptr->race();

		if (r_ptr->flags & RF_MIMIC) continue;

		if (!first) json += ',';
		first = false;
		json += '{';
		json_int(json, "id", i);
		json_str(json, "name", r_ptr->name ? r_ptr->name : "");
		json_int(json, "ch", static_cast<unsigned char>(r_ptr->x_char));
		json_int(json, "attr", r_ptr->x_attr);
		json_int(json, "y", m_ptr->fy);
		json_int(json, "x", m_ptr->fx);
		json_int(json, "hp", m_ptr->hp);
		json_int(json, "maxhp", m_ptr->maxhp);
		json_int(json, "asleep", m_ptr->csleep ? 1 : 0);
		json_int(json, "afraid", m_ptr->monfear ? 1 : 0);
		json_int(json, "unique", (r_ptr->flags & RF_UNIQUE) ? 1 : 0);
		json_int(json, "status", m_ptr->status);
		bool const inView = projectable(p_ptr->py, p_ptr->px, m_ptr->fy, m_ptr->fx);
		json_int(json, "view", inView ? 1 : 0);
		json_int(json, "target", inView && !p_ptr->image && !(r_ptr->flags & RF_NO_TARGET) ? 1 : 0);
		json_int(json, "ridx", m_ptr->r_idx);
		json_int(json, "ego", m_ptr->ego);
		json_int(json, "level", r_ptr->level, false);
		json += '}';
	}
	json += "],";

	/* Visible objects */
	json_key(json, "objects");
	json += '[';
	first = true;
	for (int i = 1; i < o_max; i++)
	{
		object_type const *o_ptr = &o_list[i];

		if (!o_ptr->k_ptr || o_ptr->held_m_idx || !o_ptr->marked) continue;
		if (o_ptr->iy >= cur_hgt || o_ptr->ix >= cur_wid) continue;
		if (!(cave[o_ptr->iy][o_ptr->ix].info & CAVE_SEEN)) continue;

		char name[160];
		object_desc(name, o_ptr, true, 0);

		if (!first) json += ',';
		first = false;
		json += '{';
		json_int(json, "id", i);
		json_str(json, "name", name);
		json_int(json, "ch", static_cast<unsigned char>(object_char(o_ptr)));
		json_int(json, "attr", object_attr(o_ptr));
		json_int(json, "gold", o_ptr->tval == TV_GOLD ? 1 : 0);
		json_int(json, "y", o_ptr->iy);
		json_int(json, "x", o_ptr->ix, false);
		json += '}';
	}
	json += "],";

	/* Recent messages, newest first */
	auto const &messages = game->messages;
	int const count = std::min<int>(messages.size(), std::max(0, max_messages));
	json_int(json, "messageTotal", messages.size());
	json_key(json, "messages");
	json += '[';
	for (int age = 0; age < count; age++)
	{
		auto const &m = messages.at(age);
		if (age) json += ',';
		json += '{';
		json_str(json, "text", m.text_with_count());
		json_int(json, "color", m.color, false);
		json += '}';
	}
	json += "]}";

	return json.c_str();
}


/*
 * Returns the pack, equipment and items underfoot as JSON. Item "i" is the
 * inventory index (equipment from INVEN_WIELD) or minus the o_list index for
 * floor items.
 */
EMSCRIPTEN_KEEPALIVE char const *web_inventory_json()
{
	json.clear();
	json += '{';

	if (!(level_ready()))
	{
		json_int(json, "ready", 0, false);
		json += '}';
		return json.c_str();
	}

	json_int(json, "ready", 1);
	json_int(json, "weight", calc_total_weight());
	json_int(json, "limit", weight_limit());

	json_key(json, "pack");
	json += '[';
	bool first = true;
	for (int i = 0; i < INVEN_PACK; i++)
	{
		object_type const *o_ptr = &p_ptr->inventory[i];
		if (!o_ptr->k_ptr) continue;
		if (!first) json += ',';
		first = false;
		json_object(json, i, o_ptr);
	}
	json += "],";

	json_key(json, "equip");
	json += '[';
	first = true;
	for (int i = INVEN_WIELD; i < INVEN_TOTAL; i++)
	{
		int const part = p_ptr->body_parts[i - INVEN_WIELD];
		if (!part) continue;
		if (!first) json += ',';
		first = false;
		object_type const *o_ptr = &p_ptr->inventory[i];
		if (o_ptr->k_ptr)
		{
			json_object(json, i, o_ptr);
			json.pop_back();
			json += ',';
		}
		else
		{
			json += '{';
			json_int(json, "i", i);
			json_int(json, "empty", 1);
		}
		json_int(json, "part", part, false);
		json += '}';
	}
	json += "],";

	json_key(json, "floor");
	json += '[';
	first = true;
	for (auto const o_idx : cave[p_ptr->py][p_ptr->px].o_idxs)
	{
		object_type const *o_ptr = &o_list[o_idx];
		if (!o_ptr->k_ptr) continue;
		if (!first) json += ',';
		first = false;
		json_object(json, -o_idx, o_ptr);
	}
	json += "]}";

	return json.c_str();
}

/*
 * Returns what the player knows about an item (see web_inventory_json for
 * the index) as plain text, lines separated by newlines.
 */
static char const *describe_object(object_type *o_ptr)
{
	if (!o_ptr->k_ptr) return json.c_str();

	char *buf = nullptr;
	std::size_t len = 0;
	FILE *fff = open_memstream(&buf, &len);
	if (!fff) return json.c_str();

	bool const known = object_out_desc(o_ptr, fff, false, false);
	fclose(fff);

	if (known && buf) json.assign(buf, len);
	free(buf);
	return json.c_str();
}

EMSCRIPTEN_KEEPALIVE char const *web_object_desc(int item)
{
	json.clear();

	if (!(level_ready())) return json.c_str();
	if (item >= INVEN_TOTAL || (item < 0 && -item >= o_max)) return json.c_str();

	return describe_object(get_object(item));
}

/*
 * Returns the description of an item on the shelf of the shop (or home)
 * the player is standing in, by its position in the stock.
 */
EMSCRIPTEN_KEEPALIVE char const *web_store_object_desc(int index)
{
	json.clear();

	if (!(level_ready() && town_info)) return json.c_str();

	auto const &c_ptr = cave[p_ptr->py][p_ptr->px];
	if (c_ptr.feat != FEAT_SHOP) return json.c_str();

	auto &stores = town_info[p_ptr->town_num].store;
	if (c_ptr.special < 0 || static_cast<std::size_t>(c_ptr.special) >= stores.size()) return json.c_str();

	auto &stock = stores[c_ptr.special].stock;
	if (index < 0 || index >= static_cast<int>(stock.size())) return json.c_str();

	return describe_object(&stock[index]);
}

/*
 * Returns the player's recall of a visible monster as JSON
 * {"name": ..., "text": [[attr, "text"], ...]}.
 */
EMSCRIPTEN_KEEPALIVE char const *web_monster_desc(int m_idx)
{
	json.clear();

	if (!(level_ready()) || m_idx <= 0 || m_idx >= m_max)
	{
		json = "{}";
		return json.c_str();
	}

	monster_type const *m_ptr = &m_list[m_idx];
	if (!m_ptr->r_idx || !m_ptr->ml)
	{
		json = "{}";
		return json.c_str();
	}

	char name[160];
	monster_desc(name, m_ptr, 0x88);

	auto const previous_hook = text_out_hook;
	text_runs.clear();
	web_scratch_term_begin();
	text_out_hook = text_out_to_json;
	monster_description_out(m_ptr->r_idx, m_ptr->ego);
	text_out_hook = previous_hook;
	web_scratch_term_end();

	json += '{';
	json_str(json, "name", name);
	json_key(json, "text");
	json += '[';
	json += text_runs;
	json += "]}";
	text_runs.clear();
	return json.c_str();
}

/*
 * Returns where the player is, for the soundtrack: dungeon, town, quest,
 * wilderness terrain, time of day and how far the main story has come.
 */
EMSCRIPTEN_KEEPALIVE char const *web_place_json()
{
	json.clear();
	json += '{';

	if (!(level_ready()))
	{
		json_int(json, "ready", 0, false);
		json += '}';
		return json.c_str();
	}

	auto const &d_info = game->edit_data.d_info;
	auto const &wf_info = game->edit_data.wf_info;
	auto const &wilderness = game->wilderness;

	json_int(json, "ready", 1);
	json_int(json, "dungeon", dungeon_type);
	json_str(json, "dungeonName", d_info[dungeon_type].name);
	json_int(json, "depth", dun_level);
	json_int(json, "maxDepth", d_info[dungeon_type].maxdepth);
	json_int(json, "wild", p_ptr->wild_mode ? 1 : 0);
	json_int(json, "wx", p_ptr->wilderness_x);
	json_int(json, "wy", p_ptr->wilderness_y);

	/* Fixed at birth: tells apart heroes who share a name. */
	std::uint8_t seed_bytes[seed_t::n_bytes];
	seed_flavor().to_bytes(seed_bytes);
	int32_t const hero_id = static_cast<int32_t>(seed_bytes[0] | (seed_bytes[1] << 8) | (seed_bytes[2] << 16) | (static_cast<uint32_t>(seed_bytes[3]) << 24));
	json_int(json, "heroId", hero_id);
	json_int(json, "kept", dun_level > 0 && get_dungeon_save_extension() ? 1 : 0);

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
	json_int(json, "town", town);
	json_int(json, "townDestroyed", (town > 0 && town_info && town_info[town].destroyed) ? 1 : 0);
	json_int(json, "quest", dun_level ? is_quest(dun_level) : p_ptr->inside_quest);

	auto const level_name = get_dungeon_name();
	json_str(json, "levelName", level_name ? *level_name : std::string());

	std::string terrain;
	int terrain_idx = -1;
	if (p_ptr->wilderness_x >= 0 && p_ptr->wilderness_y >= 0 &&
	    static_cast<std::size_t>(p_ptr->wilderness_x) < wilderness.width() &&
	    static_cast<std::size_t>(p_ptr->wilderness_y) < wilderness.height())
	{
		auto const feat = wilderness(p_ptr->wilderness_x, p_ptr->wilderness_y).feat;
		if (feat >= 0 && static_cast<std::size_t>(feat) < wf_info.size())
		{
			if (wf_info[feat].name) terrain = wf_info[feat].name;
			terrain_idx = wf_info[feat].terrain_idx;
		}
	}
	while (!terrain.empty() && terrain.back() == ' ') terrain.pop_back();
	json_str(json, "terrain", terrain);
	json_int(json, "terrainIdx", terrain_idx);

	json_int(json, "night", (turn % (10L * DAY)) < ((10L * DAY) / 2) ? 0 : 1);

	auto const done = [](int q) {
		auto const status = quest[q].status;
		return status == QUEST_STATUS_COMPLETED || status == QUEST_STATUS_REWARDED || status == QUEST_STATUS_FINISHED;
	};
	int stage = 0;
	if (done(QUEST_NECRO)) stage = 1;
	if (done(QUEST_SAURON)) stage = 2;
	if (done(QUEST_MORGOTH)) stage = 3;
	json_int(json, "stage", stage);
	json_int(json, "lev", p_ptr->lev, false);
	json += '}';

	return json.c_str();
}

/*
 * Returns the character summary shown on the web character sheet.
 */
EMSCRIPTEN_KEEPALIVE char const *web_character_json()
{
	json.clear();
	json += '{';

	if (!(level_ready()))
	{
		json_int(json, "ready", 0, false);
		json += '}';
		return json.c_str();
	}

	static char const *const stat_names[6] = { "STR", "INT", "WIS", "DEX", "CON", "CHR" };

	json_int(json, "ready", 1);
	json_key(json, "stats");
	json += '[';
	for (int i = 0; i < 6; i++)
	{
		char use[32];
		char top[32];
		cnv_stat(p_ptr->stat_use[i], use);
		cnv_stat(p_ptr->stat_top[i], top);
		if (i) json += ',';
		json += '{';
		json_str(json, "name", stat_names[i]);
		json_str(json, "use", use);
		json_str(json, "top", top);
		json_int(json, "drained", p_ptr->stat_cur[i] < p_ptr->stat_max[i] ? 1 : 0, false);
		json += '}';
	}
	json += "],";

	json_str(json, "god", deity_info[p_ptr->pgod].name);
	json_int(json, "exp", p_ptr->exp);
	json_int(json, "maxExp", p_ptr->max_exp);
	json_int(json, "nextExp", p_ptr->lev < PY_MAX_LEVEL ? static_cast<long>(player_exp[p_ptr->lev - 1]) * p_ptr->expfact / 100L : 0);
	json_int(json, "toHit", p_ptr->dis_to_h);
	json_int(json, "toDam", p_ptr->dis_to_d);
	json_int(json, "ac", p_ptr->dis_ac);
	json_int(json, "toAc", p_ptr->dis_to_a);
	json_int(json, "blows", p_ptr->num_blow);
	json_int(json, "shots", p_ptr->num_fire);
	json_int(json, "infra", p_ptr->see_infra * 10);
	json_int(json, "maxDepth", max_dlv[dungeon_type]);

	auto const &s_info = game->s_info;
	auto const &s_descriptors = game->edit_data.s_descriptors;
	json_key(json, "skills");
	json += '[';
	bool first = true;
	for (std::size_t i = 0; i < s_info.size() && i < s_descriptors.size(); i++)
	{
		if (s_info[i].hidden || s_info[i].value == 0 || s_descriptors[i].name.empty()) continue;
		if (!first) json += ',';
		first = false;
		json += '{';
		json_str(json, "name", s_descriptors[i].name);
		json_int(json, "value", s_info[i].value);
		json_int(json, "mod", s_info[i].mod, false);
		json += '}';
	}
	json += "],";

	auto const &ab_info = game->edit_data.ab_info;
	json_key(json, "abilities");
	json += '[';
	first = true;
	for (auto const ability : p_ptr->abilities)
	{
		if (ability >= ab_info.size()) continue;
		if (!first) json += ',';
		first = false;
		json_string(json, ab_info[ability].name);
	}
	json += "],";

	json_int(json, "turn", turn, false);
	json += '}';

	return json.c_str();
}

/*
 * Returns the Hall of Fame (the scores file) as JSON, best first.
 */
EMSCRIPTEN_KEEPALIVE char const *web_scores_json()
{
	auto const &race_info = game->edit_data.race_info;
	auto const &race_mod_info = game->edit_data.race_mod_info;
	auto const &class_info = game->edit_data.class_info;

	json.clear();
	json += '[';

	char buf[1024];
	path_build(buf, sizeof(buf), ANGBAND_DIR_USER, "scores.raw");
	int fd = fd_open(buf, O_RDONLY);
	if (fd < 0)
	{
		json += ']';
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

		if (i) json += ',';
		json += '{';
		json_str(json, "name", field(score.who, sizeof(score.who)));
		json_str(json, "race", race);
		json_str(json, "cls", cls);
		json_int(json, "points", atol(score.pts));
		json_int(json, "gold", atol(score.gold));
		json_int(json, "turns", atol(score.turns));
		json_str(json, "day", field(score.day, sizeof(score.day)));
		json_int(json, "level", atoi(score.cur_lev));
		json_int(json, "maxLevel", atoi(score.max_lev));
		json_int(json, "depth", atoi(score.cur_dun));
		json_int(json, "maxDepth", atoi(score.max_dun));
		json_int(json, "quest", atoi(score.inside_quest) ? 1 : 0);
		json_str(json, "how", field(score.how, sizeof(score.how)), false);
		json += '}';
	}
	fd_close(fd);

	json += ']';
	return json.c_str();
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

	json.clear();
	json += "{\"races\":[";
	for (std::size_t i = 0; i < race_info.size(); i++)
	{
		auto const &r = race_info[i];
		if (i) json += ',';
		json += '{';
		json_str(json, "title", r.title);
		json_str(json, "desc", r.desc);
		json_shared(json, r.ps);
		json_int(json, "luck", r.luck);
		json_int(json, "infra", r.infra);
		json_race_flags(json, r.flags);
		json_level_flags(json, r.lflags);
		json_skill_mods(json, r.skill_modifiers);
		json_abilities(json, r.abilities);
		json_bit_names(json, "classes", r.choice, [&](std::size_t c) { return c < class_info.size() ? class_info[c].title : std::string(); }, class_info.size());
		json_int(json, "index", i, false);
		json += '}';
	}
	json += "],\"mods\":[";
	for (std::size_t i = 0; i < race_mod_info.size(); i++)
	{
		auto const &m = race_mod_info[i];
		if (i) json += ',';
		json += '{';
		json_str(json, "title", m.title);
		json_str(json, "desc", m.description);
		json_shared(json, m.ps);
		json_int(json, "luck", m.luck);
		json_int(json, "infra", m.infra);
		json_int(json, "mana", m.mana);
		json_race_flags(json, m.flags);
		json_level_flags(json, m.lflags);
		json_skill_mods(json, m.skill_modifiers);
		json_abilities(json, m.abilities);
		json_int(json, "index", i, false);
		json += '}';
	}
	json += "],\"classes\":[";
	for (std::size_t i = 0; i < class_info.size(); i++)
	{
		auto const &c = class_info[i];
		if (i) json += ',';
		json += '{';
		json_str(json, "title", c.title);
		json_str(json, "desc", c.desc);
		json_shared(json, c.ps);
		json_int(json, "mana", c.mana);
		json_int(json, "blows", c.blow_num);
		json_int(json, "extraBlows", c.extra_blows);
		json_race_flags(json, c.flags);
		json_level_flags(json, c.lflags);
		json_skill_mods(json, c.skill_modifiers);
		json_abilities(json, c.abilities);
		json_key(json, "specs");
		json += '[';
		for (std::size_t j = 0; j < c.spec.size(); j++)
		{
			auto const &sp = c.spec[j];
			if (j) json += ',';
			json += '{';
			json_str(json, "title", sp.title ? sp.title : "");
			json_str(json, "desc", sp.desc ? sp.desc : "");
			json_race_flags(json, sp.flags);
			json_skill_mods(json, sp.skill_modifiers);
			json_abilities(json, sp.abilities);
			json_bit_names(json, "gods", { sp.gods, 0 }, [](std::size_t g) { return g < MAX_GODS ? std::string(deity_info[g].name) : std::string(); }, MAX_GODS);
			json_int(json, "index", j, false);
			json += '}';
		}
		json += "],";
		json_int(json, "index", i, false);
		json += '}';
	}
	json += "]}";
	return json.c_str();
}

/*
 * Returns the spells the player can see in the books and spell-holding
 * items carried (as tome2's spell lists show them), and the skills and
 * abilities that can be activated, in the order of tome2's menu.
 */
EMSCRIPTEN_KEEPALIVE char const *web_spells_json()
{
	json.clear();
	json += '{';
	if (!level_ready())
	{
		json_int(json, "ready", 0, false);
		json += '}';
		return json.c_str();
	}
	json_int(json, "ready", 1);
	json_key(json, "books");
	json += '[';
	bool firstBook = true;
	for (int i = 0; i < INVEN_TOTAL; i++)
	{
		object_type *o_ptr = &p_ptr->inventory[i];
		if (!o_ptr->k_ptr) continue;
		auto const f = object_flags(o_ptr);
		bool const book = o_ptr->tval == TV_BOOK || o_ptr->tval == TV_DAEMON_BOOK || o_ptr->tval == TV_INSTRUMENT;
		bool const holds = (f & TR_SPELL_CONTAIN) && o_ptr->pval2 != -1;
		if (!book && !holds) continue;
		if ((wield_slot(o_ptr) != -1) && (i < INVEN_WIELD) && (f & TR_WIELD_CAST)) continue;
		int const sval = book ? o_ptr->sval : BOOK_RANDOM;
		s32b const pval = book ? o_ptr->pval : o_ptr->pval2;
		random_book_setup(sval, pval);
		school_book *sb = school_books_at(sval);
		if (!sb) continue;

		char name[160];
		object_desc(name, o_ptr, true, 0);
		if (!firstBook) json += ',';
		firstBook = false;
		json += '{';
		json_int(json, "i", i);
		json_str(json, "name", name);
		json_key(json, "spells");
		json += '[';
		bool firstSpell = true;
		for (auto spell_idx : sb->spell_idxs)
		{
			spell_type *spell = spell_at(spell_idx);
			s32b level;
			bool na;
			get_level_school(spell, 50, -50, &level, &na);
			if (!firstSpell) json += ',';
			firstSpell = false;
			json += '{';
			json_str(json, "name", spell_type_name(spell));
			json_str(json, "school", spell_schools(spell));
			json_int(json, "level", na ? -1 : level);
			json_int(json, "mana", get_mana(spell_idx));
			json_int(json, "fail", spell_chance_book(spell_idx));
			json_str(json, "info", spell_type_info(spell));
			bool const ok = is_ok_spell(spell_idx, o_ptr->pval);
			json_int(json, "ok", ok ? 1 : 0);
			json_int(json, "short", ok && get_mana(spell_idx) > get_power(spell_idx) ? 1 : 0);
			std::string desc;
			spell_type_description_foreach(spell, [&](std::string const &line) {
				if (!desc.empty()) desc += ' ';
				desc += line;
			});
			json_str(json, "desc", desc, false);
			json += '}';
		}
		json += "]}";
	}
	json += "],";

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
	json_key(json, "bonus");
	json += '[';
	{
		std::vector<int> power_idxs(std::begin(p_ptr->powers), std::end(p_ptr->powers));
		std::sort(std::begin(power_idxs), std::end(power_idxs));
		bool firstPower = true;
		for (auto const idx : power_idxs)
		{
			auto it = game->powers.find(idx);
			if (it == game->powers.end()) continue;
			if (!firstPower) json += ',';
			firstPower = false;
			json += '{';
			json_str(json, "name", it->second->name);
			json_str(json, "desc", it->second->desc_text);
			json_int(json, "level", it->second->activation.level);
			json_int(json, "cost", it->second->activation.cost, false);
			json += '}';
		}
	}
	json += "],";
	json_key(json, "powers");
	json += '[';
	for (std::size_t i = 0; i < menu.size(); i++)
	{
		if (i) json += ',';
		json += '{';
		json_str(json, "label", menu[i].first);
		json_int(json, "mkey", menu[i].second, false);
		json += '}';
	}
	json += "]}";
	return json.c_str();
}

/*
 * Returns the skills screen's whole list (tome2 shows only a window of it),
 * in its order: [{name, depth, branch, value, mod, state, desc}], with the
 * points left. branch: 0 none, 1 closed, 2 open. Values are the ones the
 * screen shows while points are being moved.
 */
EMSCRIPTEN_KEEPALIVE char const *web_skills_json()
{
	json.clear();
	json += '{';
	if (!level_ready())
	{
		json_int(json, "ready", 0, false);
		json += '}';
		return json.c_str();
	}

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

	json_int(json, "ready", 1);
	json_int(json, "points", p_ptr->skill_points);
	json_key(json, "skills");
	json += '[';
	bool first = true;
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
			if (!first) json += ',';
			first = false;
			json += '{';
			json_str(json, "name", s_descriptors[i].name);
			json_int(json, "depth", depth);
			json_int(json, "branch", has_child(i) ? (skill.dev ? 2 : 1) : 0);
			json_int(json, "value", skill.value);
			json_int(json, "mod", skill.mod);
			json_str(json, "state", state);
			json_int(json, "misc", i == SKILL_MISC ? 1 : 0);
			json_str(json, "desc", s_descriptors[i].desc, false);
			json += '}';
			if (skill.dev) add(static_cast<int>(i), depth + 1);
		}
	};
	add(-1, 0);
	json += "]}";
	return json.c_str();
}

/*
 * Returns the abilities screen's whole list, sorted by name as tome2 does:
 * [{name, cost, known, learnable, desc, needs: [text]}], with the points left.
 */
EMSCRIPTEN_KEEPALIVE char const *web_abilities_json()
{
	json.clear();
	json += '{';
	if (!level_ready())
	{
		json_int(json, "ready", 0, false);
		json += '}';
		return json.c_str();
	}

	auto const &ab_info = game->edit_data.ab_info;
	auto const &s_descriptors = game->edit_data.s_descriptors;
	static char const *const stat_names[6] = { "STR", "INT", "WIS", "DEX", "CON", "CHR" };

	std::vector<std::size_t> table;
	for (std::size_t i = 0; i < ab_info.size(); i++)
	{
		if (!ab_info[i].name.empty()) table.push_back(i);
	}
	std::sort(table.begin(), table.end(), [&](std::size_t a, std::size_t b) { return ab_info[a].name < ab_info[b].name; });

	json_int(json, "ready", 1);
	json_int(json, "points", p_ptr->skill_points);
	json_key(json, "abilities");
	json += '[';
	bool first = true;
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
		if (!first) json += ',';
		first = false;
		json += '{';
		json_str(json, "name", ab.name);
		json_int(json, "cost", ab.cost);
		json_int(json, "known", known ? 1 : 0);
		json_int(json, "met", met ? 1 : 0);
		json_int(json, "learnable", !known && met && p_ptr->skill_points >= ab.cost ? 1 : 0);
		json_str(json, "desc", ab.desc);
		json_key(json, "needs");
		json += '[';
		for (std::size_t k = 0; k < needs.size(); k++)
		{
			if (k) json += ',';
			json_string(json, needs[k]);
		}
		json += "]}";
	}
	json += "]}";
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
