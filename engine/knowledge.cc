/*
 * What the hero knows, for the frontend's native views of tome2's knowledge
 * menu (`~`): artifacts, uniques, kills, recall depths, dungeon towns,
 * corruptions, fates and the notes file; and the hero's companions, with
 * the orders tome2's pet command (`P`, do_cmd_pet) gives them.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "artifact_type.hpp"
#include "cave_type.hpp"
#include "corrupt.hpp"
#include "defines.hpp"
#include "dungeon_info_type.hpp"
#include "fate.hpp"
#include "files.hpp"
#include "game.hpp"
#include "init1.hpp"
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
#include "player_type.hpp"
#include "town_type.hpp"
#include "util.hpp"
#include "variable.hpp"
#include "xtra1.hpp"

#include "json.hpp"

#include <emscripten.h>
#include <fmt/format.h>

#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace {

std::string json;

/* True once the character has a level (engine/snapshot.cc's level_ready). */
bool level_ready()
{
	return character_generated && cave && p_ptr;
}

/* Clears the export buffer and opens its object with "ready"; false (and closed) before a level is ready. */
bool begin_ready(JsonWriter &w)
{
	bool const ready = level_ready();
	w.begin_object();
	w.field("ready", ready ? 1 : 0);
	if (!ready) w.end_object();
	return ready;
}

JsonWriter start_json()
{
	json.clear();
	return JsonWriter(json);
}

/* An artifact somewhere the hero has not yet identified it, which tome2's list leaves out (do_cmd_knowledge_artifacts). */
static void note_unknown(object_type const *o_ptr, std::vector<bool> &okay, std::set<int> &okayk)
{
	if (!o_ptr->k_ptr || o_ptr->tval == TV_RANDART || !artifact_p(o_ptr) || object_known_p(o_ptr)) return;
	if (o_ptr->k_ptr->flags & TR_NORM_ART) okayk.erase(o_ptr->k_ptr->idx);
	else okay[o_ptr->name1] = false;
}

/* Writes an artifact by its forged object: name as tome2's list gives it ("The Phial of Galadriel"), and its glyph. */
static void json_artifact(JsonWriter &w, object_type *q_ptr)
{
	char name[160];
	object_desc_store(name, q_ptr, false, 0);
	w.begin_object();
	w.field("name", fmt::format("The {}", name));
	w.field("ch", static_cast<unsigned char>(object_char(q_ptr)));
	w.field("attr", object_attr(q_ptr));
	w.end_object();
}

/* Artifacts found, as tome2's knowledge lists them: those created, less those not yet identified on the level or carried. */
static void json_artifacts(JsonWriter &w)
{
	auto const &k_info = game->edit_data.k_info;
	auto const &a_info = game->edit_data.a_info;

	std::vector<bool> okay(a_info.size(), false);
	for (std::size_t k = 0; k < a_info.size(); k++) okay[k] = a_info[k].name && a_info[k].cur_num;
	std::set<int> okayk;
	for (auto const &k_entry : k_info)
	{
		if ((k_entry.second->flags & TR_NORM_ART) && k_entry.second->artifact) okayk.insert(k_entry.first);
	}

	for (int y = 0; y < cur_hgt; y++)
	{
		for (int x = 0; x < cur_wid; x++)
		{
			for (auto const o_idx : cave[y][x].o_idxs) note_unknown(&o_list[o_idx], okay, okayk);
		}
	}
	for (int i = 0; i < m_max; i++)
	{
		for (auto const o_idx : m_list[i].hold_o_idxs) note_unknown(&o_list[o_idx], okay, okayk);
	}
	for (int i = 0; i < INVEN_TOTAL; i++) note_unknown(&p_ptr->inventory[i], okay, okayk);

	w.key("artifacts").begin_array();
	for (std::size_t k = 0; k < a_info.size(); k++)
	{
		if (!okay[k]) continue;
		auto const a_ptr = &a_info[k];
		int const z = lookup_kind(a_ptr->tval, a_ptr->sval);
		if (!z) continue;
		object_type forge;
		object_prep(&forge, z);
		forge.name1 = k;
		if (object_flags(&forge) & TR_SPELL_CONTAIN) forge.pval2 = -1;
		json_artifact(w, &forge);
	}
	for (auto const k : game->edit_data.k_info_keys())
	{
		if (!okayk.count(k)) continue;
		object_type forge;
		object_prep(&forge, k);
		json_artifact(w, &forge);
	}
	w.end_array();
}

/* A creature race as a row: its index (for its recall), name, glyph and level. */
static void json_race(JsonWriter &w, std::size_t r_idx)
{
	auto const &r = game->edit_data.r_info[r_idx];
	w.field("r", static_cast<long>(r_idx));
	w.field("name", r.name ? r.name : "");
	w.field("ch", static_cast<unsigned char>(r.x_char));
	w.field("attr", r.x_attr);
	w.field("level", r.level);
}

/* Every unique tome2's knowledge lists (not the friendly or neutral ones, nor joke monsters unless they are on), alive or slain, by level. */
static void json_uniques(JsonWriter &w)
{
	auto const &r_info = game->edit_data.r_info;
	w.key("uniques").begin_array();
	for (std::size_t k = 1; k < r_info.size(); k++)
	{
		auto const &r = r_info[k];
		if (!(r.flags & RF_UNIQUE) || (r.flags & RF_PET) || (r.flags & RF_NEUTRAL)) continue;
		if (!options->joke_monsters && (r.flags & RF_JOKEANGBAND)) continue;
		w.begin_object();
		json_race(w, k);
		w.field("dead", r.max_num == 0 ? 1 : 0);
		w.end_object();
	}
	w.end_array();
}

/* Creatures the hero has slain: each kind with its count (a unique once, when slain). */
static void json_kills(JsonWriter &w)
{
	auto const &r_info = game->edit_data.r_info;
	w.key("kills").begin_array();
	for (std::size_t k = 1; k < r_info.size(); k++)
	{
		auto const &r = r_info[k];
		bool const unique = bool(r.flags & RF_UNIQUE);
		int const count = unique ? (r.max_num == 0 ? 1 : 0) : std::max<int>(r.r_pkills, 0);
		if (!count) continue;
		w.begin_object();
		json_race(w, k);
		w.field("count", count);
		w.field("unique", unique ? 1 : 0);
		w.end_object();
	}
	w.end_array();
}

/* Dungeons with a recall depth, the one Word of Recall takes the hero to marked; and the dungeon towns found. */
static void json_dungeons(JsonWriter &w)
{
	auto const &d_info = game->edit_data.d_info;
	w.key("recall").begin_array();
	for (std::size_t y = 1; y < d_info.size(); y++)
	{
		if (!max_dlv[y]) continue;
		w.begin_object();
		w.field("dungeon", d_info[y].name);
		w.field("depth", max_dlv[y]);
		w.field("recall", p_ptr->recall_dungeon == y ? 1 : 0);
		w.end_object();
	}
	w.end_array();

	w.key("towns").begin_array();
	for (auto const &d : d_info)
	{
		for (int j = 0; j < TOWN_DUNGEON; j++)
		{
			auto const flags = town_info[d.t_idx[j]].flags;
			if (!(flags & TOWN_REAL) || !(flags & TOWN_KNOWN)) continue;
			w.begin_object();
			w.field("dungeon", d.name);
			w.field("depth", d.t_level[j]);
			w.end_object();
		}
	}
	w.end_array();
}

/* The hero's corruptions, read from tome2's own list ("#####<colour>Name:" then its description). */
static void json_corruptions(JsonWriter &w)
{
	std::istringstream lines(dump_corruptions(true, false));
	std::string line;
	bool open = false;
	std::string desc;
	w.key("corruptions").begin_array();
	auto close = [&]() {
		if (!open) return;
		w.field("desc", desc);
		w.end_object();
		open = false;
		desc.clear();
	};
	while (std::getline(lines, line))
	{
		if (line.rfind("#####", 0) == 0 && line.size() > 6)
		{
			close();
			char const colour = line[5];
			int attr = TERM_WHITE;
			for (int c = 0; c < 16; c++)
			{
				if (conv_color[c] == colour) attr = c;
			}
			std::string name = line.substr(6);
			if (!name.empty() && name.back() == ':') name.pop_back();
			w.begin_object();
			w.field("name", name);
			w.field("attr", attr);
			open = true;
		}
		else if (open && !line.empty())
		{
			if (!desc.empty()) desc += ' ';
			desc += line;
		}
	}
	close();
	w.end_array();
}

/* The fates the hero knows, as tome2 tells them, and whether there are others still unknown. */
static void json_fates(JsonWriter &w)
{
	bool unknown = false;
	w.key("fates").begin_array();
	for (int i = 0; i < MAX_FATES; i++)
	{
		if (!fates[i].fate) continue;
		if (fates[i].know) w.value(fate_desc(i));
		else unknown = true;
	}
	w.end_array();
	w.field("fatesUnknown", unknown ? 1 : 0);
}

/* The lines of the hero's notes file (tome2's add_note: "Turn n  Lev d c: text", the birth and session banners). */
static void json_notes(JsonWriter &w)
{
	char path[1024];
	path_build(path, sizeof(path), ANGBAND_DIR_NOTE, name_file_note(game->player_base).c_str());
	std::ifstream file(path);
	std::string line;
	w.key("notes").begin_array();
	while (std::getline(file, line)) w.value(line);
	w.end_array();
}

} // namespace

extern "C" {

/*
 * Everything tome2's knowledge menu lists, as data: artifacts found (in
 * tome2's order, by kind), uniques (by level, slain or not), kills by kind,
 * recall depths, dungeon towns, corruptions, fates and the notes file's lines.
 */
EMSCRIPTEN_KEEPALIVE char const *web_knowledge_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();
	json_artifacts(w);
	json_uniques(w);
	json_kills(w);
	json_dungeons(w);
	json_corruptions(w);
	json_fates(w);
	json_notes(w);
	w.end_object();
	return json.c_str();
}

/*
 * The creatures on the hero's side on this level (status friend, pet or
 * companion), in tome2's order (the last made first), with the orders they
 * follow: follow (the leash: 1 close, 6 following, 255 seek and destroy),
 * doors and pickup.
 */
EMSCRIPTEN_KEEPALIVE char const *web_companions_json()
{
	auto w = start_json();
	if (!begin_ready(w)) return json.c_str();
	w.field("follow", p_ptr->pet_follow_distance);
	w.field("doors", p_ptr->pet_open_doors ? 1 : 0);
	w.field("pickup", p_ptr->pet_pickup_items ? 1 : 0);
	w.key("list").begin_array();
	for (int i = m_max - 1; i >= 1; i--)
	{
		auto const &m = m_list[i];
		if (!m.r_idx || m.status < MSTATUS_FRIEND) continue;
		auto const r_ptr = m.race();
		w.begin_object();
		w.field("id", i);
		w.field("r", m.r_idx);
		w.field("name", r_ptr->name ? r_ptr->name : "");
		w.field("ch", static_cast<unsigned char>(r_ptr->x_char));
		w.field("attr", r_ptr->x_attr);
		w.field("status", m.status);
		w.field("unique", (r_ptr->flags & RF_UNIQUE) ? 1 : 0);
		w.field("level", m.level);
		w.field("hp", m.hp);
		w.field("maxhp", m.maxhp);
		w.field("x", m.fx);
		w.field("y", m.fy);
		w.field("dist", m.cdis);
		w.field("seen", m.ml ? 1 : 0);
		w.field("asleep", m.csleep ? 1 : 0);
		w.field("stays", (r_ptr->flags & RF_NO_DEATH) ? 1 : 0);
		if (m.target > 0 && m.target < m_max && m_list[m.target].r_idx && m_list[m.target].ml)
		{
			w.field("target", m_list[m.target].race()->name);
		}
		w.end_object();
	}
	w.end_array();
	w.end_object();
	return json.c_str();
}

/*
 * Gives the hero's creatures an order, as do_cmd_pet does (taking no time):
 * follow 1, 6 or 255 sets the leash; doors and pickup (0 or 1, -1 to leave
 * alone) whether they open doors and pick things up (stopping drops what
 * they carry). Refused (0) while confused, as tome2 refuses.
 */
EMSCRIPTEN_KEEPALIVE int web_order_companions(int follow, int doors, int pickup)
{
	if (!level_ready() || p_ptr->confused) return 0;
	if (follow == 1 || follow == 6 || follow == 255) p_ptr->pet_follow_distance = follow;
	if (doors >= 0) p_ptr->pet_open_doors = doors != 0;
	if (pickup >= 0)
	{
		p_ptr->pet_pickup_items = pickup != 0;
		if (!pickup)
		{
			for (int i = m_max - 1; i >= 1; i--)
			{
				if (m_list[i].r_idx && m_list[i].status >= MSTATUS_PET) monster_drop_carried_objects(&m_list[i]);
			}
		}
	}
	return 1;
}

/*
 * Sets the hero's creatures on a creature (target > 0), as tome2's "give
 * target to all friends", or calls one creature off its target (calloff),
 * as "friend forget target". Refused (0) while confused.
 */
EMSCRIPTEN_KEEPALIVE int web_companions_target(int target, int calloff)
{
	if (!level_ready() || p_ptr->confused) return 0;
	if (calloff > 0)
	{
		if (calloff >= m_max || m_list[calloff].status < MSTATUS_PET) return 0;
		m_list[calloff].target = -1;
		return 1;
	}
	if (target <= 0 || target >= m_max || !m_list[target].r_idx) return 0;
	for (int i = m_max - 1; i >= 1; i--)
	{
		if (m_list[i].r_idx && m_list[i].status >= MSTATUS_PET) m_list[i].target = target;
	}
	return 1;
}

/*
 * Sends one of the hero's creatures away for good, as tome2's dismissing
 * does (not one that cannot die, RF_NO_DEATH). Refused (0) while confused.
 */
EMSCRIPTEN_KEEPALIVE int web_dismiss_companion(int m_idx)
{
	if (!level_ready() || p_ptr->confused || m_idx <= 0 || m_idx >= m_max) return 0;
	auto const &m = m_list[m_idx];
	if (!m.r_idx || m.status < MSTATUS_FRIEND || (m.race()->flags & RF_NO_DEATH)) return 0;
	delete_monster_idx(m_idx);
	return 1;
}

}
