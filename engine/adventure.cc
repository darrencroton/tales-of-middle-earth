/*
 * Adventure mode for the web frontend: a hero chosen to play it has three
 * lives. At each of the first two deaths the hero is asked, between death
 * and life, whether to return where they fell, return to the last town they
 * stood in, or accept death. tome2's own way of cheating death (HOOK_DIE,
 * as the One Ring and the wizard's "Die?" use) does the rest: full health,
 * mana and sanity, ailments cured, then a level is made where the hero is
 * sent. A kept level is loaded as it was left.
 *
 * The mode, the lives spent and the last town are kept next to the savefile
 * (`<savefile>.adventure`), written whenever tome2 writes the savefile and
 * read whenever it reads one, so they always agree with it.
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
#include "feature_flag.hpp"
#include "feature_type.hpp"
#include "files.hpp"
#include "game.hpp"
#include "hook_wild_gen_in.hpp"
#include "hooks.hpp"
#include "monster3.hpp"
#include "monster_type.hpp"
#include "options.hpp"
#include "player_type.hpp"
#include "program_args.hpp"
#include "quest_type.hpp"
#include "tables.hpp"
#include "town_type.hpp"
#include "util.hpp"
#include "z-term.hpp"
#include "variable.hpp"
#include "wilderness_map.hpp"
#include "wilderness_type_info.hpp"
#include "xtra2.hpp"

#include "json.hpp"

#include <emscripten.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

/* The question asked between death and life; the frontend shows it as its own card. */
#define RETURN_PROMPT "Halls of Waiting: [B]attlefield, [S]afety or [A]ccept death? "

void forget_saved_view();

namespace {

/* Lives in all, the first included. */
constexpr int LIVES = 3;

/* Grids searched around a landing place for a safe one. */
constexpr int LANDING_REACH = 12;

struct Adventure
{
	bool on = true;
	/* Lives spent returning from death. */
	int spent = 0;
	/* The last town the hero stood in (tome2's town index), 0 before any. */
	int town = 0;
};

Adventure adventure;

/* The hero chose to accept death: the death in progress is final. */
bool accepted = false;

/* The hero has just returned: once the level is made, they are put down where it lets them stand. */
bool returning = false;

bool hooks_added = false;

std::string side_file()
{
	return name_file_save() + ".adventure";
}

bool write_side_file()
{
	FILE *f = std::fopen(side_file().c_str(), "w");
	if (!f) return false;
	bool const ok = std::fprintf(f, "%d %d %d\n", adventure.on ? 1 : 0, adventure.spent, adventure.town) > 0;
	return (std::fclose(f) == 0) && ok;
}

void read_side_file()
{
	FILE *f = std::fopen(side_file().c_str(), "r");
	if (!f) return;
	int on = 1, spent = 0, town = 0;
	if (std::fscanf(f, "%d %d %d", &on, &spent, &town) == 3)
	{
		adventure.on = on != 0;
		adventure.spent = std::max(0, std::min(LIVES - 1, spent));
		adventure.town = std::max(0, town);
	}
	std::fclose(f);
}

int lives_left()
{
	return adventure.on ? LIVES - adventure.spent : 0;
}

/* The town of a surface area, or 0 (as tome2's generate_area reads it). */
int town_at(int x, int y)
{
	auto const &wilderness = game->wilderness;
	auto const &wf_info = game->edit_data.wf_info;
	if (x < 0 || y < 0 || static_cast<std::size_t>(x) >= wilderness.width() || static_cast<std::size_t>(y) >= wilderness.height()) return 0;
	auto const &area = wilderness(x, y);
	int town = wf_info[area.feat].entrance;
	if (!town) town = area.entrance;
	return (town > 0 && town < 1000) ? town : 0;
}

/* Where a town lies on the world map; false when it is on no area or has been destroyed. */
bool town_area(int town, int *x, int *y)
{
	if (town <= 0 || town >= max_towns || town_info[town].destroyed) return false;
	auto const &wilderness = game->wilderness;
	for (std::size_t wy = 0; wy < wilderness.height(); wy++)
	{
		for (std::size_t wx = 0; wx < wilderness.width(); wx++)
		{
			if (town_at(wx, wy) != town) continue;
			*x = wx;
			*y = wy;
			return true;
		}
	}
	return false;
}

/* The town the hero returns to for safety: the last they stood in, else the first still standing. */
int haven()
{
	int x, y;
	if (town_area(adventure.town, &x, &y)) return adventure.town;
	for (int town = 1; town < max_towns; town++)
	{
		if (town_area(town, &x, &y)) return town;
	}
	return 0;
}

std::string town_name(int town)
{
	int x, y;
	if (!town_area(town, &x, &y)) return std::string();
	auto const &wf_info = game->edit_data.wf_info;
	std::string name = wf_info[game->wilderness(x, y).feat].name ? wf_info[game->wilderness(x, y).feat].name : "";
	while (!name.empty() && name.back() == ' ') name.pop_back();
	return name;
}

/* The One Ring holds the hero: it sustains their life while it can, and then ends it, whatever lives are left. */
bool ring_hold()
{
	return quest[QUEST_ONE].status == QUEST_STATUS_FAILED_DONE;
}

/* Something in tome2 itself saves the hero from this death: the One Ring (q_one.cc), or the Blood of Life. */
bool rescued()
{
	return (ring_hold() && p_ptr->mhp > 1) || p_ptr->allow_one_death > 0;
}

/* Why the hero cannot go back to a town: an astral being climbs on foot, and where Word of Recall cannot leave, nor can they. */
char const *safety_closed()
{
	if (p_ptr->astral) return "astral";
	if ((game->dungeon_flags & DF_NO_RECALL_OUT) || dungeon_type == DUNGEON_DEATH) return "held";
	if (!haven()) return "none";
	return nullptr;
}

/* Whether this death in progress will ask the hero what to do. */
bool may_return()
{
	return alive && death && !accepted && lives_left() > 1 && !ring_hold() && !rescued();
}

enum class Choice { BATTLEFIELD, SAFETY, ACCEPT };

Choice ask()
{
	/* Keys sent before the hero fell answer nothing here. */
	flush();
	while (true)
	{
		char ch = 0;
		if (!get_com(RETURN_PROMPT, &ch)) continue;
		switch (std::tolower(static_cast<unsigned char>(ch)))
		{
		case 'b':
			return Choice::BATTLEFIELD;
		case 's':
			if (!safety_closed()) return Choice::SAFETY;
			break;
		case 'a':
			if (get_check("Accept death? Your adventure ends forever. ")) return Choice::ACCEPT;
			break;
		}
	}
}

/* Where the hero fell, as tome2 will make it again: a kept level as it was left, a quest's own level by its door on the surface. */
void go_back()
{
	returning = true;
	if (p_ptr->inside_quest)
	{
		/* tome2's quest exits lead to the surface; the hero stands by the entrance taken (enter_quest keeps it in oldpx/oldpy). */
		dun_level = 0;
		cmsg_print(TERM_L_GREEN, "You return to life by the way into the quest.");
		return;
	}
	if (!dun_level && !p_ptr->wild_mode)
	{
		/* The land is made again around the place the hero fell. */
		p_ptr->oldpy = p_ptr->py;
		p_ptr->oldpx = p_ptr->px;
	}
	cmsg_print(TERM_L_GREEN, "You return to life where you fell.");
}

/* The last town, as Word of Recall would leave the dungeon: the way back down is kept. */
void go_to_safety()
{
	int const town = haven();
	int x, y;
	if (!town_area(town, &x, &y)) return;
	if (dun_level && !p_ptr->inside_quest && !(game->edit_data.d_info[dungeon_type].flags & DF_NO_RECALL)) p_ptr->recall_dungeon = dungeon_type;
	dungeon_type = DUNGEON_WILDERNESS;
	dun_level = 0;
	p_ptr->wild_mode = false;
	p_ptr->wilderness_x = x;
	p_ptr->wilderness_y = y;
	/* The middle of the area, where its roads meet. */
	p_ptr->oldpx = 0;
	p_ptr->oldpy = 0;
	returning = true;
	cmsg_format(TERM_L_GREEN, "You return to life in %s.", town_name(town).c_str());
}

bool hurts(feature_type const &f)
{
	for (int i = 0; i < 4; i++)
	{
		if (f.d_frequency[i] && (f.d_dice[i] || f.d_side[i])) return true;
	}
	return false;
}

/* Ground a hero can stand on and live: floor, empty, no lava, deep water, glyph or rune; stairs and doors only where tome2 put the hero. */
bool livable(int y, int x, bool fixtures)
{
	if (!in_bounds(y, x)) return false;
	auto const &c = cave[y][x];
	auto const &f = game->edit_data.f_info[c.feat];
	if (!(f.flags & FF_FLOOR) || c.m_idx || c.inscription || hurts(f)) return false;
	if (c.feat == FEAT_DEEP_WATER || c.feat == FEAT_GLYPH || c.feat == FEAT_MINOR_GLYPH) return false;
	return fixtures || !(f.flags & FF_PERMANENT);
}

/* Ground a hero can walk across, creatures aside: floor and doors. */
bool passable(int y, int x)
{
	if (!in_bounds(y, x)) return false;
	auto const &f = game->edit_data.f_info[cave[y][x].feat];
	return (f.flags & FF_FLOOR) || (f.flags & FF_DOOR);
}

bool hostile_beside(int y, int x)
{
	for (int dy = -1; dy <= 1; dy++)
	{
		for (int dx = -1; dx <= 1; dx++)
		{
			if (!in_bounds(y + dy, x + dx)) continue;
			auto const m_idx = cave[y + dy][x + dx].m_idx;
			if (m_idx && is_friend(&m_list[m_idx]) < 0) return true;
		}
	}
	return false;
}

/*
 * Puts the hero on the nearest safe ground that can be walked to from where
 * tome2 placed them, out of reach of a hostile creature's next blow when
 * such ground is near.
 */
void land()
{
	int const py = p_ptr->py, px = p_ptr->px;
	if (!in_bounds(py, px)) return;
	bool const here = livable(py, px, true);
	if (here && !hostile_beside(py, px)) return;
	/* The ground within reach, nearest first by the steps to it. */
	std::vector<std::pair<int, int>> reached { { py, px } };
	std::vector<bool> seen(static_cast<std::size_t>(cur_hgt * cur_wid), false);
	seen[py * cur_wid + px] = true;
	for (std::size_t i = 0; i < reached.size(); i++)
	{
		auto const [y, x] = reached[i];
		if (std::max(std::abs(y - py), std::abs(x - px)) >= LANDING_REACH) continue;
		for (int d = 0; d < 8; d++)
		{
			int const ny = y + ddy_ddd[d], nx = x + ddx_ddd[d];
			if (!passable(ny, nx) || seen[ny * cur_wid + nx]) continue;
			seen[ny * cur_wid + nx] = true;
			reached.emplace_back(ny, nx);
		}
	}
	for (int pass = 0; pass < 2; pass++)
	{
		for (auto const &[y, x] : reached)
		{
			if (!livable(y, x, false) || (pass == 0 && hostile_beside(y, x))) continue;
			p_ptr->py = y;
			p_ptr->px = x;
			return;
		}
		if (here) return;
	}
}

/* Called once a level is made (HOOK_LEVEL_END_GEN below ground, HOOK_WILD_GEN on the surface); the world map has no ground to find. */
void after_return(bool ground)
{
	if (!returning) return;
	if (ground) land();
	returning = false;
	/* tome2's own cheat leaves these. */
	set_slow(0);
	game->died_from = "(alive and well)";
}

bool level_end_hook(void *, void *, void *)
{
	after_return(true);
	return false;
}

/* A surface area made: a town becomes the one to return to. */
bool wild_gen_hook(void *, void *in_, void *)
{
	auto const *in = static_cast<hook_wild_gen_in const *>(in_);
	if (!in->small)
	{
		int const town = town_at(p_ptr->wilderness_x, p_ptr->wilderness_y);
		if (town && !town_info[town].destroyed) adventure.town = town;
	}
	after_return(!in->small);
	return false;
}

bool die_hook(void *, void *, void *)
{
	if (!may_return()) return false;
	Choice const choice = ask();
	if (choice == Choice::ACCEPT)
	{
		accepted = true;
		return false;
	}
	adventure.spent++;
	if (choice == Choice::SAFETY) go_to_safety();
	else go_back();
	/* Last among the level's hooks, so the hero lands after quests and joke monsters have placed their creatures. */
	del_hook_new(HOOK_LEVEL_END_GEN, level_end_hook);
	add_hook_new(HOOK_LEVEL_END_GEN, level_end_hook, "web_return_level", nullptr);
	del_hook_new(HOOK_WILD_GEN, wild_gen_hook);
	add_hook_new(HOOK_WILD_GEN, wild_gen_hook, "web_return_wild", nullptr);
	msg_print(NULL);
	return true;
}

} // namespace

/* Whether the hero plays in Adventure mode, with three lives (else Roguelike, with one). */
bool adventure_mode()
{
	return adventure.on;
}

/* Called by web_snapshot (engine/snapshot.cc) on every refresh. */
void web_adventure_tick()
{
	/* tome2 can still save a hero who accepted death (Eru, the wizard's Die?); their next death is asked again. */
	if (!death) accepted = false;
	if (hooks_added) return;
	add_hook_new(HOOK_DIE, die_hook, "web_die", nullptr);
	add_hook_new(HOOK_LEVEL_END_GEN, level_end_hook, "web_return_level", nullptr);
	add_hook_new(HOOK_WILD_GEN, wild_gen_hook, "web_return_wild", nullptr);
	hooks_added = true;
}

/*
 * The hero's lives for the player JSON (web_state_json): `adventure`, the
 * lives left with this one (`lives`), and once dead `fate`: `choice` (they
 * are asked whether to return, or have chosen to and are on their way;
 * `haven` names the town, or `closed` says why there is none: `astral`,
 * `held` or `none`), `rescue` (tome2 itself saves them) or `final`.
 */
void json_adventure(JsonWriter &w)
{
	w.field("adventure", adventure.on ? 1 : 0);
	w.field("lives", lives_left());
	if (!death) return;
	bool const choice = returning || may_return();
	w.field("fate", choice ? "choice" : (alive && !accepted && rescued()) ? "rescue" : "final");
	if (!choice) return;
	char const *closed = safety_closed();
	w.key(closed ? "closed" : "haven").value(closed ? closed : town_name(haven()));
}

extern "C" {

bool __real__Z11save_playerv();
bool __real__Z11load_playerRK12program_args(program_args const &args);

/* tome2's save_player, followed by the side file; a save without it has failed. */
bool __wrap__Z11save_playerv()
{
	return __real__Z11save_playerv() && write_side_file();
}

/*
 * tome2's load_player, with the frontend's defaults for a new hero first
 * (Adventure mode, small levels), and after it the side file and the level
 * loaded cleared of the view it was saved with. A hero begun
 * from a fallen one's savefile keeps the mode, as tome2 keeps the birth
 * options, but has every life.
 */
bool __wrap__Z11load_playerRK12program_args(program_args const &args)
{
	adventure = Adventure();
	accepted = false;
	returning = false;
	options->always_small_level = true;
	bool const ok = __real__Z11load_playerRK12program_args(args);
	read_side_file();
	forget_saved_view();
	if (!character_loaded)
	{
		adventure.spent = 0;
		adventure.town = 0;
	}
	return ok;
}

/* Chooses the mode of the hero being created; false once the game has begun. */
EMSCRIPTEN_KEEPALIVE int web_set_adventure(int on)
{
	if (character_generated) return 0;
	adventure.on = on != 0;
	return 1;
}

}
