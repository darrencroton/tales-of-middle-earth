/*
 * Linked homes (Settings → Home storage): at any of the hero's homes, the shelves
 * of their other homes are shown too, and what is on them can be taken from
 * there. Each home keeps its own stock in tome2's town_info as before: what
 * is stored goes to the home the hero stands in (tome2's own command), and
 * what is taken from another home leaves that home's stock for the pack, as
 * store.cc's store_purchase takes it from the home.
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

#include "json.hpp"

#include <emscripten.h>
#include <fmt/format.h>

#include <string>

/* engine/snapshot.cc, engine/adventure.cc */
store_type *store_here(int *which);
std::string town_name(int town);
void json_stock_item(JsonWriter &w, std::size_t i, object_type *o_ptr, bool home_like, long price);

namespace {

/* Whether a home shows the others (web_set_linked_homes). */
bool linked = true;

/* The town of the home the hero stands in, or 0. */
int home_here()
{
	int which = -1;
	return store_here(&which) && which == STORE_HOME ? p_ptr->town_num : 0;
}

}

/*
 * Another home of the hero's that the home they stand in shows, or null: in
 * a town that stands, holding something. A home holds anything only once the
 * hero has had it: a quest's reward in one of the five towns of the land.
 */
store_type *linked_home(int town)
{
	int const here = home_here();
	if (!linked || !here || town == here || town <= 0 || town >= max_towns) return nullptr;
	auto &t = town_info[town];
	if (!(t.flags & TOWN_REAL) || t.destroyed || t.store.size() <= STORE_HOME) return nullptr;
	auto &home = t.store[STORE_HOME];
	return home.stock.empty() ? nullptr : &home;
}

/* The other homes the home the hero stands in shows: each one's town, its name ("place") and stock. */
void json_linked_homes(JsonWriter &w)
{
	w.key("linked").begin_array();
	for (int town = 1; town < max_towns; town++)
	{
		auto *st = linked_home(town);
		if (!st) continue;
		w.begin_object();
		w.field("town", town);
		w.field("place", town_name(town));
		w.key("stock").begin_array();
		for (std::size_t i = 0; i < st->stock.size(); i++) json_stock_item(w, i, &st->stock[i], true, 0);
		w.end_array();
		w.end_object();
	}
	w.end_array();
}

extern "C" {

/* Whether a home shows the hero's other homes (Settings → Home storage, on unless set off). */
EMSCRIPTEN_KEEPALIVE void web_set_linked_homes(int on)
{
	linked = on != 0;
}

/*
 * Takes `amount` of an item (by its place in the stock) from another home
 * the home the hero stands in shows into the pack, as store_purchase takes
 * from the home: a wand's charges shared out, at most 99, only with room in
 * the pack, and its "You have …" logged. Only inside the home (its screen
 * up). Returns the pack slot it went to, -1 when it cannot be taken, -2 with
 * no room in the pack.
 */
EMSCRIPTEN_KEEPALIVE int web_home_take(int town, int index, int amount)
{
	store_type *st = character_icky ? linked_home(town) : nullptr;
	if (!st || index < 0 || index >= static_cast<int>(st->stock.size())) return -1;
	auto &o_ref = st->stock[index];
	if (amount < 1 || amount > o_ref.number || amount > 99) return -1;

	object_type forge;
	object_copy(&forge, &o_ref);
	forge.number = amount;
	if (o_ref.tval == TV_WAND) forge.pval = o_ref.pval * amount / o_ref.number;
	if (!inven_carry_okay(&forge)) return -2;

	if (o_ref.tval == TV_WAND) o_ref.pval -= forge.pval;
	o_ref.number -= amount;
	if (!o_ref.number) st->stock.erase(st->stock.begin() + index);

	int const slot = inven_carry(&forge, false);
	char name[160];
	object_desc(name, &p_ptr->inventory[slot], true, 3);
	game->messages.add(fmt::format("You have {} ({}).", name, index_to_label(slot)), TERM_WHITE);
	handle_stuff();
	return slot;
}

}
