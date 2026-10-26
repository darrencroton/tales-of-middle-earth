/*
 * Game state export for the web renderer.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "cave_type.hpp"
#include "defines.hpp"
#include "dungeon_info_type.hpp"
#include "feature_flag.hpp"
#include "feature_type.hpp"
#include "game.hpp"
#include "monster2.hpp"
#include "monster_race.hpp"
#include "monster_race_flag.hpp"
#include "monster_type.hpp"
#include "object1.hpp"
#include "object_flag.hpp"
#include "object_kind.hpp"
#include "object_type.hpp"
#include "options.hpp"
#include "player_class.hpp"
#include "player_race.hpp"
#include "player_spec.hpp"
#include "player_type.hpp"
#include "spells1.hpp"
#include "store_info_type.hpp"
#include "variable.hpp"

#include <emscripten.h>

#include <cstdint>
#include <string>
#include <vector>

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
	H_COUNT
};

constexpr int32_t SNAPSHOT_VERSION = 2;

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

}

extern "C" {

/*
 * Rebuilds the level arrays and returns the header (see HeaderSlot).
 */
EMSCRIPTEN_KEEPALIVE int32_t const *web_snapshot()
{
	auto const &f_info = game->edit_data.f_info;

	bool const ready = character_dungeon && cave && p_ptr;

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

	if (!(character_dungeon && cave && p_ptr))
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
		json_int(json, "status", m_ptr->status, false);
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

}
