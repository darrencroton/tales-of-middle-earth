/*
 * Run options for the web frontend: tome2's birth options and the number of
 * random quests, read and changed from the frontend's last character
 * creation screen, before the game begins.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "defines.hpp"
#include "game.hpp"
#include "monster2.hpp"
#include "options.hpp"
#include "q_rand.hpp"
#include "quest_type.hpp"
#include "random_quest.hpp"
#include "tables.hpp"
#include "variable.hpp"

#include <emscripten.h>

#include <algorithm>
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

/* Draws the random quests again, as tome2's birth does once it has asked how many. */
void draw_random_quests(int n)
{
	n = options->ironman_rooms ? 0 : std::clamp(n, 0, MAX_RANDOM_QUEST - 1);
	quest[QUEST_RANDOM].status = QUEST_STATUS_UNTAKEN;
	get_monster_hook = monster_quest;
	get_mon_num_prep();
	initialize_random_quests(n);
	drawn_quests = n;
}

std::string json;

} // namespace

/* Called by web_snapshot (engine/snapshot.cc) on every refresh. */
void web_run_options_tick()
{
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
 * where it finds no creature to hunt), and the most there can be.
 */
EMSCRIPTEN_KEEPALIVE char const *web_run_options_json()
{
	json = "{\"options\":[";
	bool first = true;
	for (auto const &option : RUN_OPTIONS)
	{
		if (!first) json += ',';
		first = false;
		json += "{\"name\":\"";
		json += option.name;
		json += "\",\"on\":";
		json += options && (options->*option.value) ? '1' : '0';
		json += '}';
	}
	json += "],\"drawn\":" + std::to_string(random_quest_count());
	json += ",\"maxQuests\":" + std::to_string(MAX_RANDOM_QUEST - 1);
	json += '}';
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

}
