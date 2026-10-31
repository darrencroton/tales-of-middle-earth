/*
 * Map memory for the web frontend: floors the hero has seen stay on the map,
 * dungeon levels can be kept as they were left, and the frontend can restore
 * what the hero remembers of an area of the land.
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
#include "dungeon_flag.hpp"
#include "dungeon_info_type.hpp"
#include "files.hpp"
#include "game.hpp"
#include "hooks.hpp"
#include "level_data.hpp"
#include "loadsave.hpp"
#include "monster_race.hpp"
#include "monster_race_flag.hpp"
#include "player_type.hpp"
#include "quest_type.hpp"
#include "random_quest.hpp"
#include "tables.hpp"
#include "util.hpp"
#include "variable.hpp"

#include <emscripten.h>

#include <cstdint>
#include <string>
#include <vector>

/* q_god.cc: the Lost Temple, whose quest fails when a level is generated twice. */
constexpr std::size_t DUNGEON_LOST_TEMPLE = 30;

/*
 * The quest of the level the hero is on, done or not, or 0: the fixed quest
 * whose own level this is, the random quest of this depth in a main dungeon
 * (QUEST_RANDOM), Merton's level of the Maze, Thráin's level of Dol Guldur,
 * or a god's lost temple.
 */
int level_quest()
{
	if (p_ptr->inside_quest) return p_ptr->inside_quest;
	if (dun_level < 1) return 0;
	if (dun_level < MAX_RANDOM_QUEST && (game->dungeon_flags & DF_PRINCIPAL) && random_quests[dun_level].type) return QUEST_RANDOM;
	auto const &hobbit = quest[QUEST_HOBBIT];
	if (dungeon_type == DUNGEON_MAZE && dun_level == hobbit.data[0] && hobbit.status >= QUEST_STATUS_TAKEN) return QUEST_HOBBIT;
	/* tome2 takes Thráin's quest on the first arrival, after the level (and his hidden cell) is built. */
	auto const &thrain = quest[QUEST_THRAIN];
	if (dungeon_type == DUNGEON_DOL_GULDUR && dun_level == thrain.data[0] && thrain.status >= QUEST_STATUS_UNTAKEN) return QUEST_THRAIN;
	if (dungeon_type == DUNGEON_LOST_TEMPLE && quest[QUEST_GOD].status >= QUEST_STATUS_TAKEN) return QUEST_GOD;
	return 0;
}

/* Whether the quest of this level is still to be done here. */
bool level_quest_open()
{
	int const q = level_quest();
	switch (q)
	{
	case 0: return false;
	case QUEST_RANDOM: return !random_quests[dun_level].done;
	case QUEST_THRAIN: return quest[q].status < QUEST_STATUS_FINISHED;
	default: return quest[q].status == QUEST_STATUS_TAKEN;
	}
}

namespace {

/* Prefix of the save extensions this frontend gives to levels (tome2's own special levels keep theirs). */
constexpr char const *LEVEL_EXT_PREFIX = "lvl";


/* Angband depths of the final quests. */
constexpr int ANGBAND_FINAL_DEPTH = 99;

/* -1 until the frontend says; 0 or 1 afterwards. */
int persistent_wanted = -1;
int persistent_applied = -1;
bool forget_pending = false;
bool hooks_added = false;

/* The level the hero is on: noted when it is built (or first seen after loading a game), as commands change the key before leaving. */
byte here_dungeon = 0;
int here_depth = 0;
bool here_known = false;

/* A level key whose save extension is taken away while tome2 saves the level being left under it. */
struct Suspended
{
	std::size_t dungeon;
	int depth;
	boost::optional<std::string> ext;
};
boost::optional<Suspended> suspended;

/* Grids for web_mark_known, filled by the frontend. */
std::vector<int32_t> mark_buf;

std::string level_ext(std::size_t d, int depth)
{
	return LEVEL_EXT_PREFIX + std::to_string(d) + "_" + std::to_string(depth);
}

bool ours(level_data const &data)
{
	return data.save_extension && data.save_extension->rfind(LEVEL_EXT_PREFIX, 0) == 0;
}

bool eligible_dungeon(std::size_t d)
{
	return d != DUNGEON_WILDERNESS &&
	       d != DUNGEON_LOST_TEMPLE &&
	       static_cast<s32b>(d) != DUNGEON_DEATH;
}

bool eligible_depth(std::size_t d, int depth)
{
	return depth > 0 && !(d == DUNGEON_ANGBAND && depth >= ANGBAND_FINAL_DEPTH);
}

/* Levels tome2 must make afresh: quests place their monsters or vaults each time a level is built. */
bool quest_level_here()
{
	return p_ptr->inside_quest || level_quest_open();
}

/* Gives a level this frontend's save extension, or takes it away. */
void keep_level(std::size_t d, int depth, bool keep)
{
	auto &by_depth = game->edit_data.d_info[d].level_data_by_depth;
	if (keep)
	{
		auto &data = by_depth[depth];
		if (!data.save_extension && !data.map_name) data.save_extension = level_ext(d, depth);
		return;
	}
	auto it = by_depth.find(depth);
	if (it != by_depth.end() && ours(it->second)) it->second.save_extension = boost::none;
}

/*
 * Takes the save extension away from the quest level the hero is on, as
 * loaded from a savefile or when levels have just been made kept: built
 * levels are handled by level_begin_hook.
 */
void keep_off_quest_level()
{
	if (persistent_applied != 1 || !character_dungeon || !dun_level) return;
	if (eligible_dungeon(dungeon_type) && eligible_depth(dungeon_type, dun_level) && quest_level_here()) keep_level(dungeon_type, dun_level, false);
}

void apply_persistence()
{
	if (persistent_wanted < 0 || persistent_wanted == persistent_applied || !game) return;
	auto const &d_info = game->edit_data.d_info;
	if (d_info.empty()) return;

	bool const on = persistent_wanted == 1;
	for (std::size_t d = 0; d < d_info.size(); d++)
	{
		if (!eligible_dungeon(d)) continue;
		for (int depth = d_info[d].mindepth; depth <= d_info[d].maxdepth; depth++)
		{
			if (eligible_depth(d, depth)) keep_level(d, depth, on);
		}
	}
	persistent_applied = persistent_wanted;
	forget_pending = !on;
	keep_off_quest_level();
}

/* Deletes the kept levels of the hero being played, and lets the uniques kept on them appear again. */
void forget_levels()
{
	for (auto &r: game->edit_data.r_info)
	{
		if (r.flags & RF_UNIQUE) r.on_saved = false;
	}

	auto const &d_info = game->edit_data.d_info;
	for (std::size_t d = 0; d < d_info.size(); d++)
	{
		if (!eligible_dungeon(d)) continue;
		for (int depth = d_info[d].mindepth; depth <= d_info[d].maxdepth; depth++)
		{
			if (eligible_depth(d, depth)) fd_kill(name_file_dungeon_save(level_ext(d, depth)).c_str());
		}
	}
}

/* Marks every lit grid in view as remembered, as tome2's view_torch_grids option does for floors. */
void remember_seen()
{
	if (!cave || !character_dungeon) return;
	for (int i = 0; i < view_n; i++)
	{
		int const y = view_y[i];
		int const x = view_x[i];
		if (y >= cur_hgt || x >= cur_wid) continue;
		auto &c = cave[y][x];
		if (c.info & CAVE_SEEN) c.info |= CAVE_MARK;
	}
}

void note_here()
{
	if (here_known || !character_dungeon || p_ptr->leaving) return;
	here_dungeon = dungeon_type;
	here_depth = dun_level;
	here_known = true;
	keep_off_quest_level();
}

/*
 * Saves the level being left under its own key. tome2 saves it only after
 * the move, when a branch staircase has already changed the dungeon (and
 * leaving a dungeon has made it the wilderness), so it would be written
 * under another dungeon's key, or not at all; that wrong key's extension is
 * suspended until the next level is built.
 */
void save_left_level()
{
	if (here_depth <= 0) return;
	if (dungeon_type != here_dungeon && !suspended)
	{
		auto &by_depth = game->edit_data.d_info[dungeon_type].level_data_by_depth;
		auto it = by_depth.find(here_depth);
		if (it != by_depth.end() && it->second.save_extension)
		{
			suspended = Suspended { dungeon_type, here_depth, it->second.save_extension };
			it->second.save_extension = boost::none;
		}
	}
	byte const d = dungeon_type;
	s16b const depth = dun_level;
	dungeon_type = here_dungeon;
	dun_level = here_depth;
	save_dungeon();
	dungeon_type = d;
	dun_level = depth;
	here_depth = 0;
	here_known = false;
}

bool level_begin_hook(void *, void *, void *)
{
	if (suspended)
	{
		game->edit_data.d_info[suspended->dungeon].level_data_by_depth[suspended->depth].save_extension = suspended->ext;
		suspended = boost::none;
	}
	here_dungeon = dungeon_type;
	here_depth = dun_level;
	here_known = true;
	if (persistent_applied != 1) return false;
	if (!eligible_dungeon(dungeon_type)) return false;
	if (eligible_depth(dungeon_type, dun_level)) keep_level(dungeon_type, dun_level, !quest_level_here());
	/* A fixed quest's level is begun at depth 1 and moved to the quest's own depth as it is built (q_thief.cc and the others): that depth must not keep it either. */
	int const q = p_ptr->inside_quest;
	if (q > 0 && q < MAX_Q_IDX && eligible_depth(dungeon_type, quest[q].level)) keep_level(dungeon_type, quest[q].level, false);
	return false;
}

bool end_turn_hook(void *, void *, void *)
{
	remember_seen();
	if (p_ptr->leaving) save_left_level();
	return false;
}

} // namespace

/* Called by web_snapshot (engine/snapshot.cc) on every refresh. */
void web_memory_tick()
{
	if (!hooks_added)
	{
		add_hook_new(HOOK_GEN_LEVEL_BEGIN, level_begin_hook, "web_level_begin", nullptr);
		add_hook_new(HOOK_END_TURN, end_turn_hook, "web_end_turn", nullptr);
		hooks_added = true;
	}
	apply_persistence();
	if (!character_generated || !p_ptr) return;
	if (forget_pending)
	{
		forget_levels();
		forget_pending = false;
	}
	note_here();
	remember_seen();
}

extern "C" {

/*
 * Whether dungeon levels stay as the hero left them (1) or are made anew on
 * each visit as in classic ToME (0). Turning it off forgets kept levels.
 */
EMSCRIPTEN_KEEPALIVE void web_set_persistent_levels(int on)
{
	persistent_wanted = on ? 1 : 0;
	apply_persistence();
}

/* Room for `count` grid indices (y * width + x of the current level) for web_mark_known. */
EMSCRIPTEN_KEEPALIVE int32_t *web_mark_buffer(int count)
{
	mark_buf.assign(count > 0 ? count : 0, -1);
	return mark_buf.data();
}

/* Marks the grids in the mark buffer as remembered; returns how many were not already. */
EMSCRIPTEN_KEEPALIVE int web_mark_known()
{
	if (!character_generated || !character_dungeon || !cave || !p_ptr) return 0;
	int marked = 0;
	for (int32_t const cell: mark_buf)
	{
		if (cell < 0 || cell >= cur_wid * cur_hgt) continue;
		auto &c = cave[cell / cur_wid][cell % cur_wid];
		if (c.info & CAVE_MARK) continue;
		c.info |= CAVE_MARK;
		marked++;
	}
	mark_buf.clear();
	if (marked) p_ptr->redraw |= PR_MAP;
	return marked;
}

}
