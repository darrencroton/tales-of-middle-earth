/*
 * Run options for the web frontend: tome2's birth options and the number of
 * random quests, read and changed from the frontend's last character
 * creation screen, before the game begins; and the size of a small level.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "defines.hpp"
#include "dungeon_flag.hpp"
#include "dungeon_info_type.hpp"
#include "files.hpp"
#include "game.hpp"
#include "hooks.hpp"
#include "levels.hpp"
#include "monster2.hpp"
#include "monster_race.hpp"
#include "monster_race_flag.hpp"
#include "options.hpp"
#include "q_rand.hpp"
#include "quest_type.hpp"
#include "random_quest.hpp"
#include "tables.hpp"
#include "variable.hpp"
#include "z-rand.hpp"

#include "json.hpp"

#include <emscripten.h>

#include <algorithm>
#include <cctype>
#include <iterator>
#include <string>

namespace {

struct RunOption {
	char const *name;
	bool options::*value;
};

/* The birth options the frontend offers, by the names it uses. */
RunOption const RUN_OPTIONS[] = {
	{ "smallLevels", &options::always_small_level },
	{ "fates", &options::fate_option },
	{ "preserve", &options::preserve },
	{ "noSelling", &options::no_selling },
	{ "unusualRooms", &options::ironman_rooms },
	{ "jokes", &options::joke_monsters },
};

/* The number of random quests drawn on the last screen, kept for tome2's "same character" start; -1 when unchanged. */
int drawn_quests = -1;

int random_quest_count()
{
	int n = 0;
	for (auto const &q : random_quests)
	{
		if (q.type) n++;
	}
	return n;
}

/* Draws the random quests again, as tome2's birth does once it has asked how many, first freeing the uniques the last draw kept for its quests. */
void draw_random_quests(int n)
{
	auto &r_info = game->edit_data.r_info;
	for (auto const &q : random_quests)
	{
		if (!q.type || q.r_idx <= 0 || static_cast<std::size_t>(q.r_idx) >= r_info.size()) continue;
		auto &r_ptr = r_info[q.r_idx];
		if ((r_ptr.flags & RF_UNIQUE) && r_ptr.max_num == -1) r_ptr.max_num = 1;
	}
	n = options->ironman_rooms ? 0 : std::clamp(n, 0, MAX_RANDOM_QUEST - 1);
	quest[QUEST_RANDOM].status = QUEST_STATUS_UNTAKEN;
	get_monster_hook = monster_quest;
	get_mon_num_prep();
	initialize_random_quests(n);
	drawn_quests = n;
}

std::string json;

/* The sizes of a small level, in screens across and down: those of tome2's six that are a third of a full level or less. */
int const SMALL_SIZES[][2] = { { 1, 1 }, { 1, 2 }, { 2, 1 }, { 1, 3 } };

/* The dungeon given a size by small_level_hook for the level being built; -1 when none. */
int sized_dungeon = -1;

bool small_levels_hooked = false;

/*
 * Takes back the last level's size, then, with small levels on, gives the
 * dungeon level about to be built one of SMALL_SIZES as its dungeon's own
 * size. Not on the surface, nor in a dungeon with a size of its own, built
 * vast (BIG: Erebor, Moria) or of one screen (SMALLEST: the Maze).
 */
bool small_level_hook(void *, void *, void *)
{
	auto &d_info = game->edit_data.d_info;
	if (sized_dungeon >= 0)
	{
		d_info[sized_dungeon].size_x = -1;
		d_info[sized_dungeon].size_y = -1;
		sized_dungeon = -1;
	}
	if (!options->always_small_level || !dun_level) return false;
	auto &d_ptr = d_info[dungeon_type];
	if (d_ptr.size_x != -1 || ((game->dungeon_flags | get_level_flags()) & (DF_BIG | DF_SMALLEST))) return false;
	auto const &size = SMALL_SIZES[rand_int(std::size(SMALL_SIZES))];
	d_ptr.size_x = size[0];
	d_ptr.size_y = size[1];
	sized_dungeon = dungeon_type;
	return false;
}

} // namespace

/* engine/adventure.cc */
bool adventure_mode();

/* Called by web_snapshot (engine/snapshot.cc) on every refresh. */
void web_run_options_tick()
{
	if (!small_levels_hooked)
	{
		add_hook_new(HOOK_GEN_LEVEL_BEGIN, small_level_hook, "web_small_level", nullptr);
		small_levels_hooked = true;
	}
	/* tome2 notes the quests it drew itself for the next "same character" start once the game begins. */
	if (character_generated && drawn_quests >= 0)
	{
		game->previous_char.quests = drawn_quests;
		drawn_quests = -1;
	}
}

extern "C" {

/*
 * The run options as JSON: the birth options in order, each by name and
 * whether it is on, the number of random quests drawn (tome2 skips a level
 * where it finds no creature to hunt), the most there can be, and whether
 * the hero plays in Adventure mode (engine/adventure.cc).
 */
EMSCRIPTEN_KEEPALIVE char const *web_run_options_json()
{
	json.clear();
	JsonWriter w(json);
	w.begin_object();
	w.key("options").begin_array();
	for (auto const &option : RUN_OPTIONS)
	{
		w.begin_object();
		w.field("name", option.name);
		w.field("on", options && (options->*option.value) ? 1 : 0);
		w.end_object();
	}
	w.end_array();
	w.field("drawn", random_quest_count());
	w.field("maxQuests", MAX_RANDOM_QUEST - 1);
	w.field("adventure", adventure_mode() ? 1 : 0);
	w.end_object();
	return json.c_str();
}

/*
 * Turns a birth option (by its place in web_run_options_json) on or off.
 * Only while a character is being created; false otherwise.
 */
EMSCRIPTEN_KEEPALIVE int web_set_run_option(int index, int on)
{
	int const count = sizeof(RUN_OPTIONS) / sizeof(RUN_OPTIONS[0]);
	if (character_generated || !options || index < 0 || index >= count) return 0;
	auto const value = RUN_OPTIONS[index].value;
	options->*value = on != 0;
	if (value == &options::ironman_rooms && on) draw_random_quests(0);
	return 1;
}

/*
 * Draws the random quests again, this many (none with unusual rooms).
 * Only while a character is being created; false otherwise.
 */
EMSCRIPTEN_KEEPALIVE int web_set_random_quests(int n)
{
	if (character_generated || !options) return 0;
	draw_random_quests(n);
	return 1;
}

static std::string hero_name;

EMSCRIPTEN_KEEPALIVE char *web_name_buffer(int bytes)
{
	hero_name.assign(static_cast<std::size_t>(std::max(0, bytes)), '\0');
	return hero_name.data();
}

/*
 * Names the hero being created (written to the buffer web_name_buffer
 * returns), and the savefile with it, so a hero begun anew from a fallen
 * one's savefile is kept in a savefile of its own. Only while a character is
 * being created, and only a name tome2 accepts (1 to 15 characters, none a
 * control character); false otherwise.
 */
EMSCRIPTEN_KEEPALIVE int web_set_hero_name()
{
	if (character_generated || hero_name.empty() || hero_name.size() > 15) return 0;
	for (auto c : hero_name)
	{
		if (iscntrl(static_cast<unsigned char>(c))) return 0;
	}
	game->player_name = hero_name;
	set_player_base(hero_name);
	return 1;
}

}
