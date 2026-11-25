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
 * and what was chosen.
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

#include <string>
#include <vector>

/* What tome2's point selection is choosing while it waits: 0 nothing, 1 a place, 2 a creature whose kind Genocide erases. */
int choosing_point = 0;

namespace {

/* What the next point chosen is for. */
int point_purpose = 1;

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
		bool const spared = (r_ptr->flags & RF_UNIQUE) || (m.mflag & MFLAG_QUEST);
		out.push_back({ i, m.r_idx, r_ptr->name ? r_ptr->name : "", m.fx, m.fy, m.ml && !p_ptr->image, spared, static_cast<unsigned char>(r_ptr->x_char), r_ptr->x_attr });
	}
	return out;
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

/* The last genocide, for web_state_json: {n, mass, outcome, race, ch, attr, spared, erased, seen: [{x, y, ch, attr}]}. */
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
	bool const chosen = __real__Z6tgt_ptPiS_(x, y);
	choosing_point = 0;
	pick = { chosen, *x, *y };
	return chosen;
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
