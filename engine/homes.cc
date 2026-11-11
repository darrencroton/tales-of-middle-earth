/*
 * Linked homes (Settings → Home storage): the home the hero stands in shows
 * the shelves of all their homes as one, as if everything were stored there,
 * and hands out anything on it. Each home keeps its own stock in tome2's
 * town_info as before: what is stored goes to the home the hero stands in
 * (tome2's own command), and what is taken leaves the stock of the homes
 * that hold it for the pack, as store.cc's store_purchase takes it.
 *
 * Copyright (c) 1997 Ben Harrison, and others
 *
 * This software may be copied and distributed for educational, research,
 * and not for profit purposes provided that this copyright and statement
 * are included in all such copies.
 */

#include "defines.hpp"
#include "game.hpp"
#include "object1.hpp"
#include "object2.hpp"
#include "object_type.hpp"
#include "player_type.hpp"
#include "store_type.hpp"
#include "town_type.hpp"
#include "variable.hpp"
#include "xtra1.hpp"
#include "z-term.hpp"

#include <emscripten.h>
#include <fmt/format.h>

#include <algorithm>
#include <vector>

/* engine/snapshot.cc */
store_type *store_here(int *which);

namespace {

/* Whether the home shows all the hero's homes as one (web_set_linked_homes). */
bool linked = true;

/* Where some of an item on the shelf shown is kept: a home's stock and its place there. */
struct Source
{
	store_type *home;
	std::size_t index;
};

/* An item on the shelf shown: all of it, as one stack, and the stacks it is made of. */
struct Shelved
{
	object_type object;
	std::vector<Source> sources;
};

/* The shelf shown, kept from the last time it was made (its objects are the ones inspected). */
std::vector<Shelved> shelf;

/* Whether `o_ptr` goes before `j_ptr` on a home's shelf, as store.cc's home_carry places it. */
bool before(object_type const *o_ptr, object_type const *j_ptr)
{
	if (o_ptr->tval != j_ptr->tval) return o_ptr->tval > j_ptr->tval;
	if (!object_aware_p(o_ptr)) return false;
	if (!object_aware_p(j_ptr)) return true;
	if (o_ptr->sval != j_ptr->sval) return o_ptr->sval < j_ptr->sval;
	if (!object_known_p(o_ptr)) return false;
	if (!object_known_p(j_ptr)) return true;
	if (o_ptr->tval == TV_ROD_MAIN && o_ptr->timeout != j_ptr->timeout) return o_ptr->timeout < j_ptr->timeout;
	return object_value(o_ptr) > object_value(j_ptr);
}

/* Puts some of an item kept in a home on the shelf shown, as home_carry would: onto a stack it joins, else in its place. */
void shelve(store_type *home, std::size_t index)
{
	auto &o_ref = home->stock[index];
	for (auto &s : shelf)
	{
		if (!object_similar(&s.object, &o_ref)) continue;
		object_type copy;
		object_copy(&copy, &o_ref);
		object_absorb(&s.object, &copy);
		s.sources.push_back({ home, index });
		return;
	}
	std::size_t slot = 0;
	while (slot < shelf.size() && !before(&o_ref, &shelf[slot].object)) slot++;
	Shelved s;
	object_copy(&s.object, &o_ref);
	s.sources.push_back({ home, index });
	shelf.insert(shelf.begin() + slot, s);
}

/* The town of the home the hero stands in, or 0. */
int home_here()
{
	int which = -1;
	return store_here(&which) && which == STORE_HOME ? p_ptr->town_num : 0;
}

/*
 * The hero's homes the home they stand in shows, itself first: the others in
 * towns that stand, holding something. A home holds anything only once the
 * hero has had it: a quest's reward in one of the five towns of the land.
 */
std::vector<store_type *> homes()
{
	int const here = home_here();
	if (!here) return {};
	std::vector<store_type *> found { &town_info[here].store[STORE_HOME] };
	if (!linked) return found;
	for (int town = 1; town < max_towns; town++)
	{
		auto &t = town_info[town];
		if (town == here || !(t.flags & TOWN_REAL) || t.destroyed || t.store.size() <= STORE_HOME) continue;
		if (!t.store[STORE_HOME].stock.empty()) found.push_back(&t.store[STORE_HOME]);
	}
	return found;
}

/* Makes the shelf shown afresh from the homes'. */
void make_shelf()
{
	shelf.clear();
	for (auto *home : homes())
	{
		for (std::size_t i = 0; i < home->stock.size(); i++) shelve(home, i);
	}
}

/* Takes `amount` of a home's stack into the pack, as store_purchase takes from the home (a wand's charges shared out); the pack slot it went to. */
int take(Source const &from, int amount)
{
	auto &o_ref = from.home->stock[from.index];
	object_type forge;
	object_copy(&forge, &o_ref);
	forge.number = amount;
	if (o_ref.tval == TV_WAND)
	{
		forge.pval = o_ref.pval * amount / o_ref.number;
		o_ref.pval -= forge.pval;
	}
	o_ref.number -= amount;
	if (!o_ref.number) from.home->stock.erase(from.home->stock.begin() + from.index);
	return inven_carry(&forge, false);
}

}

/*
 * The shelf the home the hero stands in shows, while homes are linked: every
 * home's items as one, or null (homes not linked, or not in a home).
 */
std::vector<object_type const *> *linked_shelf()
{
	static std::vector<object_type const *> objects;
	if (!linked || !home_here()) return nullptr;
	make_shelf();
	objects.clear();
	for (auto const &s : shelf) objects.push_back(&s.object);
	return &objects;
}

extern "C" {

/* Whether the home shows all the hero's homes as one (Settings → Home storage, on unless set off). */
EMSCRIPTEN_KEEPALIVE void web_set_linked_homes(int on)
{
	linked = on != 0;
}

/*
 * Takes `amount` of an item on the shelf linked homes show (by its place
 * there) into the pack, from the stacks it is made of, this home's first,
 * as store_purchase takes from the home: at most 99, each stack only with
 * room in the pack, and "You have …" logged. Only inside the home (its
 * screen up). Returns how many were taken, -1 when it cannot be taken, -2
 * with no room in the pack.
 */
EMSCRIPTEN_KEEPALIVE int web_home_take(int index, int amount)
{
	if (!character_icky || !linked_shelf() || index < 0 || index >= static_cast<int>(shelf.size())) return -1;
	auto sources = shelf[index].sources;
	if (amount < 1 || amount > shelf[index].object.number || amount > 99) return -1;

	int taken = 0;
	int slot = -1;
	for (std::size_t s = 0; s < sources.size() && taken < amount; s++)
	{
		auto const from = sources[s];
		object_type part;
		object_copy(&part, &from.home->stock[from.index]);
		part.number = std::min<int>(amount - taken, part.number);
		if (!inven_carry_okay(&part)) break;
		bool const emptied = part.number == from.home->stock[from.index].number;
		slot = take(from, part.number);
		taken += part.number;
		for (auto &later : sources)
		{
			if (emptied && later.home == from.home && later.index > from.index) later.index--;
		}
	}
	if (!taken) return -2;

	char name[160];
	object_desc(name, &p_ptr->inventory[slot], true, 3);
	game->messages.add(fmt::format("You have {} ({}).", name, index_to_label(slot)), TERM_WHITE);
	handle_stuff();
	return taken;
}

}
