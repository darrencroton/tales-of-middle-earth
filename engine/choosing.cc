/*
 * Choosing a point on the map, and what Genocide made of the choice, for the
 * web frontend.
 *
 * tome2 asks for a point with tgt_pt: a free cursor moved by direction keys,
 * Space choosing and Escape cancelling, asked for in a message ("Select a
 * point and press space.") that flows past with the others. Genocide, the Void
 * Jumpgate, Dimension Door, Convey recall, Stone prison, Earthquake, Magelock,
 * Unholy word, Discharge minion, Symbiosis and taking a companion all use it.
 * Its wrap notes while it waits (`choosing_point`, in the snapshot's header)
 * and what was chosen. Its cursor keeps to the part of the level tome2's
 * screen shows (its panel, 66x22 grids round the hero), not the map the
 * player sees, so `web_point_at` puts the point anywhere on the
 * level, moving the panel to it: a key then shows the cursor there, and
 * Space chooses it. The panel is put back once tgt_pt returns, as tome2
 * sees creatures only on its panel (update_mon) and draws bolts only there. Its key hints are left out of the message log
 * (`point_hint`): the frontend's card says what to do.
 *
 * Genocide (its scroll, its staff and Udun's spell, an activation) erases
 * every creature on the level drawn with the symbol of one the hero chooses,
 * uniques and quest foes aside; Mass Genocide every such creature within
 * sight's reach. tome2 says nothing of what they did, so their wraps note it
 * (`json_genocide`, in web_state_json): stopped by the level, nothing chosen,
 * no creature at the place chosen, or cast, with the creatures erased that
 * the hero saw. Whether anything at all was erased is told too: the strain
 * hurts the hero for each, so tome2 lets them feel it.
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
#include "game.hpp"
#include "monster_race.hpp"
#include "monster_race_flag.hpp"
#include "monster_type.hpp"
#include "player_type.hpp"
#include "util.hpp"
#include "variable.hpp"

#include "json.hpp"

#include <emscripten.h>

#include <algorithm>
#include <string>
#include <vector>

/* The map's size on tome2's screen (xtra2.cc, not in its headers). */
void get_screen_size(int *wid_p, int *hgt_p);

/* What tome2's point selection is choosing while it waits: 0 nothing, 1 a place, 2 a creature whose kind Genocide erases. */
int choosing_point = 0;

namespace {

/* What the next point chosen is for. */
int point_purpose = 1;

/* tgt_pt's point, while it waits. */
int *point_x = nullptr;
int *point_y = nullptr;

/* The last point chosen, if one was. */
struct Pick
{
	bool chosen = false;
	int x = 0;
	int y = 0;
} pick;

/* A creature on the level before a genocide. */
struct Creature
{
	int idx;
	int r_idx;
	std::string name;
	int x;
	int y;
	bool seen;
	bool unique;
	bool spared;
	int ch;
	int attr;
};

/* The last genocide: `serial` counts them, so the frontend tells each once. */
struct Genocide
{
	int serial = 0;
	bool mass = false;
	char const *outcome = "";
	std::string race;
	int ch = 0;
	int attr = 0;
	bool unique = false;
	bool spared = false;
	bool erased = false;
	std::vector<Creature> seen;
} last;

/* tome2's own test in genocide and mass_genocide. */
bool genocide_stopped()
{
	return (game->dungeon_flags & DF_NO_GENO) || (dungeon_type == DUNGEON_DEATH);
}

std::vector<Creature> creatures()
{
	std::vector<Creature> out;
	for (int i = 1; i < m_max; i++)
	{
		auto const &m = m_list[i];
		if (!m.r_idx) continue;
		auto const r_ptr = m.race();
		bool const unique = static_cast<bool>(r_ptr->flags & RF_UNIQUE);
		bool const spared = unique || (m.mflag & MFLAG_QUEST);
		out.push_back({ i, m.r_idx, r_ptr->name ? r_ptr->name : "", m.fx, m.fy, m.ml && !p_ptr->image, unique, spared, static_cast<unsigned char>(r_ptr->x_char), r_ptr->x_attr });
	}
	return out;
}

/* Moves tome2's panel to start at a row and column, as change_panel and the static panel_bounds do. */
void set_panel(int row, int col)
{
	int wid, hgt;
	get_screen_size(&wid, &hgt);
	panel_row_min = std::max(0, std::min(row, cur_hgt - hgt));
	panel_col_min = std::max(0, std::min(col, cur_wid - wid));
	panel_row_max = std::min(panel_row_min + hgt - 1, cur_hgt - 1);
	panel_col_max = std::min(panel_col_min + wid - 1, cur_wid - 1);
	panel_row_prt = panel_row_min - ROW_MAP;
	panel_col_prt = panel_col_min - COL_MAP;
	p_ptr->redraw |= PR_MAP;
}

/* Runs tome2's genocide or mass genocide and notes what it did. */
template <typename F>
void note_genocide(bool mass, F real)
{
	Genocide g;
	g.serial = last.serial + 1;
	g.mass = mass;
	if (genocide_stopped())
	{
		/* tome2 says so for Mass Genocide and a fated death, not for Genocide on a level that forbids it. */
		if (!mass && (game->dungeon_flags & DF_NO_GENO)) msg_print("A mysterious force stops the genocide.");
		real();
		g.outcome = "stopped";
		last = g;
		return;
	}
	auto const before = creatures();
	pick = Pick();
	point_purpose = mass ? 1 : 2;
	real();
	point_purpose = 1;
	g.outcome = "cast";
	if (!mass)
	{
		Creature const *chosen = nullptr;
		for (auto const &c : before)
		{
			if (pick.chosen && c.x == pick.x && c.y == pick.y) chosen = &c;
		}
		if (!pick.chosen) g.outcome = "cancelled";
		else if (!chosen) g.outcome = "empty";
		else if (chosen->seen)
		{
			g.race = chosen->name;
			g.ch = chosen->ch;
			g.attr = chosen->attr;
			g.unique = chosen->unique;
			g.spared = chosen->spared;
		}
	}
	for (auto const &c : before)
	{
		if (m_list[c.idx].r_idx == c.r_idx) continue;
		g.erased = true;
		if (c.seen) g.seen.push_back(c);
	}
	last = g;
}

}

/* tome2's key hints as it asks for a point (tgt_pt, and Genocide before it), left out of the message log. */
bool point_hint(std::string const &msg)
{
	return msg == "Select a point and press space." || msg == "Target a monster to select the race to genocide.";
}

/* The last genocide, for web_state_json: {n, mass, outcome, race, ch, attr, unique, spared, erased, seen: [{x, y, ch, attr}]}. */
void json_genocide(JsonWriter &w)
{
	if (!last.serial) return;
	w.key("genocide").begin_object();
	w.field("n", last.serial);
	w.field("mass", last.mass ? 1 : 0);
	w.field("outcome", last.outcome);
	if (!last.race.empty())
	{
		w.field("race", last.race);
		w.field("ch", last.ch);
		w.field("attr", last.attr);
		w.field("unique", last.unique ? 1 : 0);
		w.field("spared", last.spared ? 1 : 0);
	}
	w.field("erased", last.erased ? 1 : 0);
	w.key("seen").begin_array();
	for (auto const &c : last.seen)
	{
		w.begin_object();
		w.field("x", c.x);
		w.field("y", c.y);
		w.field("ch", c.ch);
		w.field("attr", c.attr);
		w.end_object();
	}
	w.end_array();
	w.end_object();
}

extern "C" {

bool __real__Z6tgt_ptPiS_(int *x, int *y);
void __real__Z8genocidev();
void __real__Z13mass_genocidev();

/* tome2's tgt_pt, noted while it waits and once a point is chosen. */
bool __wrap__Z6tgt_ptPiS_(int *x, int *y)
{
	choosing_point = point_purpose;
	point_x = x;
	point_y = y;
	int const row = panel_row_min;
	int const col = panel_col_min;
	bool const chosen = __real__Z6tgt_ptPiS_(x, y);
	choosing_point = 0;
	point_x = nullptr;
	point_y = nullptr;
	if (row != panel_row_min || col != panel_col_min) set_panel(row, col);
	pick = { chosen, *x, *y };
	return chosen;
}

/*
 * Puts tome2's point cursor on a grid while it waits, short of the level's
 * edge as tgt_pt keeps it; the panel moves to centre the grid when the grid
 * is not well within it (tgt_pt's cursor never stands on its first row or
 * column). Returns 1 when it is there, 0 at the level's edge, -1 when tome2
 * is not asking for a point.
 */
EMSCRIPTEN_KEEPALIVE int web_point_at(int x, int y)
{
	if (!point_x || !point_y) return -1;
	if (x <= 0 || y <= 0 || x >= cur_wid - 1 || y >= cur_hgt - 1) return 0;
	int wid, hgt;
	get_screen_size(&wid, &hgt);
	bool const across = x > panel_col_min && x < panel_col_min + wid;
	bool const down = y > panel_row_min && y < panel_row_min + hgt;
	if (!across || !down) set_panel(y - hgt / 2, x - wid / 2);
	*point_x = x;
	*point_y = y;
	return 1;
}

void __wrap__Z8genocidev()
{
	note_genocide(false, __real__Z8genocidev);
}

void __wrap__Z13mass_genocidev()
{
	note_genocide(true, __real__Z13mass_genocidev);
}

}
