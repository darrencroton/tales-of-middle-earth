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
#include "player_type.hpp"
#include "random_quest.hpp"
#include "util.hpp"
#include "variable.hpp"

#include <emscripten.h>

#include <cstdint>
#include <string>
#include <vector>

namespace {

/* Prefix of the save extensions this frontend gives to levels (tome2's own special levels keep theirs). */
constexpr char const *LEVEL_EXT_PREFIX = "lvl";

/* q_god.cc: the Lost Temple, whose quest fails when a level is generated twice. */
constexpr std::size_t DUNGEON_LOST_TEMPLE = 30;

/* Angband depths of the final quests. */
constexpr int ANGBAND_FINAL_DEPTH = 99;

/* -1 until the frontend says; 0 or 1 afterwards. */
int persistent_wanted = -1;
int persistent_applied = -1;
bool forget_pending = false;
bool hooks_added = false;

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

/* Levels tome2 must make afresh: quests place their monsters each time a level is built. */
bool quest_level_here()
{
	if (p_ptr->inside_quest || is_quest(dun_level)) return true;
	if (dun_level < 1 || dun_level >= MAX_RANDOM_QUEST) return false;
	auto const &q = random_quests[dun_level];
	return (game->dungeon_flags & DF_PRINCIPAL) && q.type && !q.done;
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
}

/* Deletes the kept levels of the hero being played. */
void forget_levels()
{
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

bool level_begin_hook(void *, void *, void *)
{
	if (persistent_applied != 1) return false;
	if (!eligible_dungeon(dungeon_type) || !eligible_depth(dungeon_type, dun_level)) return false;
	keep_level(dungeon_type, dun_level, !quest_level_here());
	return false;
}

bool end_turn_hook(void *, void *, void *)
{
	remember_seen();
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
