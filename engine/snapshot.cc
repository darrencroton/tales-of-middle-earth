/*
 * Game state export for the web renderer.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "cave.hpp"
#include "cave_type.hpp"
#include "defines.hpp"
#include "dungeon_info_type.hpp"
#include "feature_flag.hpp"
#include "feature_type.hpp"
#include "game.hpp"
#include "hiscore.hpp"
#include "deity_type.hpp"
#include "inventory.hpp"
#include "levels.hpp"
#include "monster1.hpp"
#include "monster2.hpp"
#include "monster_race.hpp"
#include "monster_race_flag.hpp"
#include "monster_type.hpp"
#include "object1.hpp"
#include "object2.hpp"
#include "object_flag.hpp"
#include "object_kind.hpp"
#include "object_type.hpp"
#include "options.hpp"
#include "player_class.hpp"
#include "player_race.hpp"
#include "player_spec.hpp"
#include "player_type.hpp"
#include "quest_type.hpp"
#include "spells1.hpp"
#include "store_info_type.hpp"
#include "store_type.hpp"
#include "tables.hpp"
#include "town_type.hpp"
#include "util.hpp"
#include "variable.hpp"
#include "wilderness_map.hpp"
#include "wilderness_type_info.hpp"
#include "xtra1.hpp"

#include <emscripten.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <string>
#include <vector>

/* Off-screen terminal (engine/main-web.cc). */
void web_scratch_term_begin();
void web_scratch_term_end();

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

EMSCRIPTEN_KEEPALIVE int32_t const *web_snapshot()
{
	auto const &f_info = game->edit_data.f_info;

	bool const ready = level_ready();

	if (auto_more_override >= 0 && options) options->auto_more = auto_more_override != 0;

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

}
