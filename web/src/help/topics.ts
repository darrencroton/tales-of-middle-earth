import { RUN_OPTION_TEXT } from '../flow/runoptions.ts';

/**
 * The game's help: our own topics, grouped for finding things quickly. Text
 * may use *bold* for names of buttons and things to look for.
 */

export type HelpBlock =
  | string
  | { heading: string }
  | { list: string[] }
  | { steps: string[] }
  | { terms: [string, string][] }
  | { tip: string };

/** Topics built from the game's own data rather than written here. */
export type HelpSpecial = 'races' | 'manual';

export interface HelpTopic {
  id: string;
  title: string;
  icon: string;
  /** One line under the title in lists. */
  summary: string;
  /** Other words a player might search for. */
  keywords?: string;
  body: HelpBlock[];
  /** Related topics, by id. */
  see?: string[];
  special?: HelpSpecial;
}

export interface HelpGroup {
  title: string;
  topics: HelpTopic[];
}

export const HELP: readonly HelpGroup[] = [
  {
    title: 'Start here',
    topics: [
      {
        id: 'welcome',
        title: 'Welcome to Middle-earth',
        icon: '☼',
        summary: 'What the game is, and what you are here to do.',
        keywords: 'goal quest aim win roguelike permadeath sauron morgoth ring',
        body: [
          'Tales of Middle-earth is a roguelike: every dungeon level is made when you first enter it, no two adventures are alike, and when your hero falls, that tale is over. It is hard, and that is half the fun: each hero teaches you something for the next.',
          { heading: 'Your quest' },
          'A shadow lies over Mirkwood. Your first great task is to find the Necromancer in the tower of *Dol Guldur* and defeat him. That wakes a greater evil: *Sauron* must be found and beaten, and the *One Ring* cast into the fires of *Mount Doom*, where it was forged. Last of all, *Morgoth* waits in the depths of *Angband*.',
          'It is a long road. Along the way are towns to rest in, people who need help, dozens of dungeons and treasures with stories of their own.',
          { heading: 'How a game goes' },
          {
            list: [
              'Get ready in town: gear, food, light and healing.',
              'Go down into a dungeon: explore, fight and gather what you find.',
              'Come back up to sell, buy and recover.',
              'Grow with every level: spend skill points, learn abilities, find better gear, and go a little deeper each time.',
            ],
          },
        ],
        see: ['first-steps', 'controls', 'survival'],
      },
      {
        id: 'first-steps',
        title: 'Your first adventure',
        icon: '⚑',
        summary: 'A safe way through the first hour.',
        keywords: 'beginner new start begin tutorial guide newbie',
        body: [
          {
            steps: [
              '*Check your gear.* Open *Items* and tap what you started with to wield or wear it.',
              '*Shop in Bree.* Walk into a shop’s door to trade. The General Store has food, torches, a lantern and flasks of oil; the Alchemist has scrolls of *Phase Door* and *Word of Recall*; the Temple has healing potions.',
              '*Find a way down.* Look around Bree and the land beyond it: *Explore* walks it for you, but won’t lead you into a dungeon.',
              '*Discover the Barrow-downs.* Take the road west out of Bree, over the bridge, and where it turns north keep on west through the woods; the stairs down are a little way beyond. If you reach the grasslands you’ve gone too far.',
              '*Fight one at a time.* Stand in a corridor so only one creature can reach you, and press and hold anything new to see what it is first.',
              '*Rest after each fight.* *Rest* brings back health and mana, and stops if anything comes into view.',
              '*Go back up* when you are hurt, out of potions or your pack is full. Sell what you found, restock, and go a little deeper next time.',
            ],
          },
          { tip: 'Your first heroes will fall. That is part of the game: the Hall of Fame keeps their tales, and each one leaves you knowing the world a little better.' },
        ],
        see: ['shops', 'explore', 'fighting', 'new-hero'],
      },
      {
        id: 'controls',
        title: 'Playing by touch',
        icon: '☝',
        summary: 'Tap, hold, drag and pinch.',
        keywords: 'gesture tap touch move walk travel zoom pan look hold swipe close back',
        body: [
          {
            terms: [
              ['Tap a place', 'Walk there by the way you know. A tap on somewhere unseen takes one step towards it.'],
              ['Tap next to you', 'One step. A creature there is attacked; a closed door is opened.'],
              ['Tap yourself', 'Wait a turn, to let a creature come to you.'],
              ['Press and hold', 'Look at anything on the map: creatures, items, terrain.'],
              ['Drag', 'Look around without moving. Your next move brings the view back.'],
              ['Pinch', 'Zoom the map.'],
              ['Tap the messages', 'Read the whole message log.'],
              ['Tap your name', 'Your character: tap your name by your health, below the map (beside it with the phone on its side).'],
              ['Tap a creature or item below the map', 'What it is, and what you can do with it.'],
            ],
          },
          'Walking stops by itself when a creature comes into view, when you are hurt, or when your light goes out. A tap on the map while you walk stops you too.',
          { heading: 'Pop-ups' },
          {
            list: [
              'Close a pop-up with ✕, a tap outside it, or a swipe down on its heading. ‹ goes back to the one before.',
              'In a list, the highlighted row follows the arrow keys or your swipes; tap a row, or press Enter, to choose it.',
              'Questions (how many, which way, yes or no) appear as a card over the map.',
            ],
          },
        ],
        see: ['toolbar', 'keyboard'],
      },
      {
        id: 'toolbar',
        title: 'The toolbar',
        icon: '▭',
        summary: 'What each button does, and the one that changes.',
        keywords: 'button bar action descend ascend stairs attack pick up wield explore way down way up again cast fire items rest more menu',
        body: [
          'The first button changes with where you are and what is around you. It is the first of these that applies:',
          {
            terms: [
              ['Walk here', 'On the world map: walk into the land beneath you.'],
              ['Descend, Ascend, Enter, Leave', 'You stand on stairs, a path or a gate: take it. On stairs, this button is always those stairs.'],
              ['Attack', 'A creature stands next to you: strike the weakest. Red brackets on the map show which.'],
              ['Pick up, Drink, Sacrifice', 'Something lies at your feet, or you stand at a fountain or an altar.'],
              ['Eat, Wield, Light', 'You are hungry, your weapon hand is empty, or you have no light below ground. *Light* also relights a torch or lantern that has gone out.'],
              ['Explore', 'Walk on to the next place you have not seen.'],
              ['Way down, Way up', 'This dungeon level is explored: go straight to its stairs.'],
              ['World map', 'This area of the land is explored: step out onto the world map.'],
            ],
          },
          { heading: 'Your own buttons' },
          'These keep their places, so your thumb learns them:',
          {
            terms: [
              ['Again', 'Named for what it repeats: your last spell or power, or for heroes who do not cast, the last thing you aimed. It aims at the nearest foe.'],
              ['Cast or Powers', 'Your spells and powers.'],
              ['Fire', 'Shoot the nearest foe, while a bow, sling or crossbow is wielded.'],
              ['Items', 'Your pack, your equipment and what lies at your feet.'],
              ['Rest', 'Rest until you have recovered, or until something happens.'],
              ['More', 'Every other command, by group.'],
              ['Menu', 'Your character, messages, knowledge, saving, settings and this help.'],
            ],
          },
          'A dimmed button cannot be used just now: tap it to hear why. It takes no time.',
          'While you explore, the toolbar is *Stop*, *Speed* and *Menu*.',
        ],
        see: ['explore', 'stairs', 'magic'],
      },
      {
        id: 'keyboard',
        title: 'Playing with a keyboard',
        icon: '⌨',
        summary: 'Arrow keys, the classic keys, and the on-screen keyboard.',
        keywords: 'keys hardware bluetooth arrow shift run keymap',
        body: [
          'With a keyboard, the arrow keys walk and Shift with an arrow runs. The classic ToME command keys all work; the ones with screens of their own here (*i*, *e*, *~*, *?*) open them.',
          'In lists, the arrow keys move the highlight, Enter chooses and Escape goes back.',
          'When the game wants typed keys, *Keys* (⌨) on the toolbar brings up the on-screen keyboard.',
        ],
        see: ['controls'],
      },
    ],
  },
  {
    title: 'Exploring',
    topics: [
      {
        id: 'explore',
        title: 'Explore and travel',
        icon: '⇢',
        summary: 'Let your hero walk, and stop when it matters.',
        keywords: 'auto explore automatic travel walk stop speed pace relaxed gold spotted companion pet push past swap',
        body: [
          '*Explore* walks to the places you have not seen yet, filling in the map around where you started before heading further out. It picks up gold on the way, and tells you about any items it passes.',
          'It stops when a creature comes into sight, when you are hurt or robbed, when your light goes out or it is too dark to see, and when a creature blocks the only way. A creature already in view will not stop it again. Your companions do not block it: you push past them, swapping places, unless you are confused, stunned or seeing things.',
          'Once a dungeon level is explored, Explore goes straight to the way on: down while you are heading down, up once you have turned back.',
          '*Speed* switches between a normal and a relaxed pace while you explore, without stopping. Settings → Exploring sets the pace for good.',
          { heading: 'Travel' },
          'Tap any place you have seen to walk there. If the way is not known all the way, you walk as close as the map allows.',
        ],
        see: ['stairs', 'toolbar', 'light'],
      },
      {
        id: 'stairs',
        title: 'Stairs and levels',
        icon: '⇵',
        summary: 'Going down, coming back, and levels that stay.',
        keywords: 'staircase descend ascend depth level recall kept persistent way down way up',
        body: [
          'Stand on stairs and the toolbar shows what they do: *Descend* on a way down, *Ascend* on a way up. Each level down is more dangerous, and holds better treasure.',
          'Levels stay as you left them (Settings → Dungeon levels), so the way back is the way you came. Once a level is explored, step off the stairs and *Way down* or *Way up* takes you straight across it.',
          'Some levels are always made anew: quest levels and a few special places.',
          { heading: 'Word of Recall' },
          'A scroll of *Word of Recall* takes you from a dungeon back to town, and from town back down to the deepest level you reached there. It takes a while to work, so read it before you need it.',
        ],
        see: ['explore', 'dungeons', 'land'],
      },
      {
        id: 'land',
        title: 'Towns, the land and the world map',
        icon: '⌂',
        summary: 'Towns, the wilds and long journeys.',
        keywords: 'town bree gondolin lothlorien minas anor khazad-dum wilderness world map journey travel',
        body: [
          'Every tale begins in *Bree*. Other towns lie far away: *Gondolin*, *Lothlórien*, *Minas Anor* and *Khazad-dûm*, each with shops of its own.',
          'Beyond a town, the land goes on area by area: walk off the edge of one into the next. Explore walks each area for you, but leaves finding dungeon entrances and secret places to you; once an area is seen, it offers the *World map*.',
          '*World map* lifts you up to see the whole land, where each step covers a great distance and time flies. *Walk here* sets you down again.',
          'Carry plenty of food and spare light before a long journey.',
        ],
        see: ['dungeons', 'stairs', 'shops'],
      },
      {
        id: 'dungeons',
        title: 'Dungeons of Middle-earth',
        icon: '▼',
        summary: 'Some of the places to go, and how deep they run.',
        keywords: 'dungeon barrow-downs mirkwood moria angband mordor dol guldur mount doom depth',
        body: [
          'A few of the dungeons, and the levels they span:',
          {
            terms: [
              ['Barrow-downs, 1 to 10', 'The gentlest start, near Bree.'],
              ['Orc Cave, 10 to 22', ''],
              ['Mirkwood, 11 to 33', 'The dark forest the Necromancer has poisoned.'],
              ['The Old Forest, 13 to 25', ''],
              ['Cirith Ungol, 25 to 50', ''],
              ['Moria, 30 to 50', ''],
              ['Mordor, 34 to 66', ''],
              ['Dol Guldur, 57 to 70', 'The Necromancer’s tower.'],
              ['Erebor, 60 to 72', ''],
              ['Angband, 67 to 127', 'Morgoth’s fortress.'],
              ['Mount Doom, 85 to 99', 'Where the Ring was forged, and can be unmade.'],
            ],
          },
          'Their entrances are out on the land, waiting to be found; some open only through quests. Press and hold an entrance to see where it leads.',
        ],
        see: ['stairs', 'quests'],
      },
    ],
  },
  {
    title: 'Fighting and survival',
    topics: [
      {
        id: 'fighting',
        title: 'Fighting',
        icon: '⚔',
        summary: 'Blows, missiles, and choosing your battles.',
        keywords: 'attack melee combat missile shoot fire throw bow arrow target foe enemy creature monster',
        body: [
          'Walk into a creature, tap it beside you, or tap *Attack* to strike. *Fire* shoots the nearest foe with your launcher; throwing, wands and other attacks are under *More*.',
          'Press and hold a creature before you fight it: once you have met its kind, its description tells you what it can do.',
          {
            list: [
              'Fight in corridors, so only one foe can reach you.',
              'Not everything needs fighting: some creatures are better left asleep, or walked away from.',
              'Spellcasters and breathers hurt from afar: close in quickly, or step out of their sight.',
              'Packs of hounds and wolves surround you in the open: back into a corridor.',
            ],
          },
        ],
        see: ['survival', 'ailments', 'magic'],
      },
      {
        id: 'survival',
        title: 'Staying alive',
        icon: '♥',
        summary: 'Health, healing, and getting out.',
        keywords: 'hp health hit points heal healing potion escape phase door teleport die death dead',
        body: [
          'Watch your health bar. *Rest* between fights brings it back; healing potions are for emergencies, and *Recently used* at the top of your pack keeps them one tap away.',
          { heading: 'Ways out' },
          {
            terms: [
              ['Phase Door', 'A short hop away, to break off a fight.'],
              ['Teleportation', 'Far across the level.'],
              ['Teleport Level', 'Off the level altogether, up or down.'],
              ['Stairs', 'Always a way out, if you can reach them.'],
              ['Word of Recall', 'Home to town, but only after a while.'],
            ],
          },
          'Leave while you still can: an escape works best before a fight turns bad.',
          'Death is final. Your hero’s tale goes into the Hall of Fame, and a new hero begins.',
        ],
        see: ['ailments', 'fighting', 'deeds'],
      },
      {
        id: 'ailments',
        title: 'Ailments and hunger',
        icon: '☠',
        summary: 'Poison, cuts, fear, hunger and more.',
        keywords: 'status poison poisoned cut bleeding stun stunned confused blind afraid fear paralysed paralyzed hallucinating slow fast hungry hunger weak food eat eating starving',
        body: [
          'Ailments show in the strip below your health. Most wear off with time; potions cure them sooner.',
          {
            terms: [
              ['Poisoned', 'You lose a little health each turn until it passes.'],
              ['Cut', 'You bleed, and do not heal while you do. Small cuts close in time; a mortal wound needs curing.'],
              ['Stunned', 'You fight and think badly. A heavy stun can knock you out.'],
              ['Confused', 'You stagger about and cannot read scrolls.'],
              ['Blind', 'You cannot see or read.'],
              ['Afraid', 'You cannot fight hand to hand. Missiles and magic still work.'],
              ['Paralysed', 'You cannot act at all. Free action protects against it.'],
              ['Hallucinating', 'What you see is not what is there.'],
              ['Slow, Fast', 'Fewer or more turns than those around you.'],
              ['Hungry, Weak', 'Eat something. Weakness makes you feeble, and starving heroes faint. The toolbar offers *Eat* when you are hungry.'],
            ],
          },
        ],
        see: ['survival', 'items'],
      },
      {
        id: 'light',
        title: 'Light and darkness',
        icon: '☀',
        summary: 'Torches, lanterns and fuel.',
        keywords: 'light torch lantern lamp oil flask fuel dark darkness refuel',
        body: [
          'Below ground you need a light to see. A torch burns out in time; a lantern burns three times as long and refills from flasks of oil.',
          'When your light grows faint you are warned. When it goes out, exploring stops and the toolbar offers *Light*: it puts a spare torch to the spent one, refills a lantern from a flask, or lights another light from your pack.',
          'Carry spares. Some rare lights never need fuel.',
          'Explore will not wander in the dark: without a light, it stops and says so.',
        ],
        see: ['explore', 'items'],
      },
    ],
  },
  {
    title: 'Items and shops',
    topics: [
      {
        id: 'items',
        title: 'Your pack and equipment',
        icon: '≡',
        summary: 'Using, wearing and managing what you carry.',
        keywords: 'inventory pack equipment item use wear wield drop destroy throw inscribe weight potion scroll wand staff rod quiver identify',
        body: [
          '*Items* opens your pack, your equipment and what lies at your feet. Tap an item for its description and everything you can do with it.',
          'Items name themselves as soon as you step on them or pick them up.',
          'Carrying too much slows you down: the pack shows your load against what you can carry.',
          { heading: 'Kinds of things' },
          {
            terms: [
              ['Potions', 'Drink them. Healing, cures and stranger things.'],
              ['Scrolls', 'Read them; not while blind or confused.'],
              ['Wands and staffs', 'Aim a wand; use a staff. Both hold charges.'],
              ['Rods', 'Zap them. They recharge by themselves.'],
              ['Food', 'Eat when hungry.'],
              ['Ammunition', 'Arrows, bolts and shots, fired from the quiver by a launcher.'],
              ['Artifacts', 'Unique treasures, often with powers of their own.'],
            ],
          },
        ],
        see: ['shops', 'light'],
      },
      {
        id: 'shops',
        title: 'Shops and money',
        icon: '$',
        summary: 'Buying, selling and your home.',
        keywords: 'shop store buy sell gold money price home stash keep museum donate general store armoury weaponsmith temple alchemist magic black market',
        body: [
          'Walk into a shop’s door to trade; standing at the door, *Enter shop* on the toolbar takes you back in. *Buy* lists everything for sale, *Sell* what you carry. Tap an item for its description, then *Buy* or *Sell*, choosing how many. Things you cannot afford, or the shop will not take, are dimmed and say why.',
          'Each shop buys only its own kind of goods, and some specialist shops buy nothing at all. Unless you chose *No selling* when you began, shops pay for what they take. With No selling they pay nothing, but gold found lying about is worth five times as much.',
          'Your *Home* keeps anything you leave there safe: *Inventory* to store what you carry, *Stored* to take it back.',
          {
            terms: [
              ['General Store', 'Food, torches, lanterns, oil, cloaks, ammunition, digging tools.'],
              ['Armoury', 'Armour, helms, boots, gloves and shields.'],
              ['Weaponsmith', 'Blades, axes, polearms, bows and slings.'],
              ['Temple', 'Blunt weapons, healing potions, Word of Recall.'],
              ['Alchemist', 'Scrolls: Phase Door, Word of Recall, Satisfy Hunger and more.'],
              ['Magic shop', 'Rings, amulets, wands, staffs and rods.'],
              ['Black market', 'Rare things, at a price.'],
            ],
          },
          'Charisma makes for better prices.',
        ],
        see: ['items', 'first-steps'],
      },
    ],
  },
  {
    title: 'Your hero',
    topics: [
      {
        id: 'character',
        title: 'Your character',
        icon: '@',
        summary: 'Stats, level and the character sheet.',
        keywords: 'character sheet stats strength intelligence wisdom dexterity constitution charisma level experience summary',
        body: [
          'Tap your name by your health, or Menu → Character. *Summary* shows your health, mana, stats and progress; *Skills* and *Abilities* are where you grow; *Full sheet* lists every bonus and resistance.',
          {
            terms: [
              ['Strength', 'Harder blows, and more you can carry.'],
              ['Intelligence', 'The power behind most spells.'],
              ['Wisdom', 'The power behind prayers, and resisting magic.'],
              ['Dexterity', 'Hitting, dodging and striking more often.'],
              ['Constitution', 'More health, and faster recovery.'],
              ['Charisma', 'Better prices in shops.'],
            ],
          },
          'Experience comes from defeating creatures. Your race and class change how much each level needs.',
        ],
        see: ['skills', 'races'],
      },
      {
        id: 'skills',
        title: 'Skills and abilities',
        icon: '±',
        summary: 'How your hero grows.',
        keywords: 'skill points ability abilities learn raise lower spend level up',
        body: [
          'Each new level brings *6 skill points*. Spend them on the Skills tab of your character, or tap *skill points to spend* when it shows under your health.',
          'A point raises a skill by an amount your race and class decide: skills your class is good at grow much faster. A skill can be raised to at most your level plus four.',
          'Spend points on what you use: a fighter’s Combat and weapon mastery, a caster’s Magic and their school, and for everyone, skills that keep you alive.',
          'Points can be taken back with *Lower* until you leave the Skills screen, when you are asked to keep them.',
          { heading: 'Abilities' },
          '*Abilities* are lasting talents bought with skill points. Each shows its cost and what it needs first: skill levels, other abilities or stats. Learning one is permanent.',
        ],
        see: ['character', 'magic', 'races'],
      },
      {
        id: 'races',
        title: 'Races and classes',
        icon: '♙',
        summary: 'What each race, modifier and class brings.',
        keywords: 'race class subrace modifier specialisation elf dwarf hobbit human warrior mage priest ranger',
        body: [
          'Your *race* sets your stats and gifts and which skills come easily; a *race modifier* (Barbarian, Vampire and others) adds its own; your *class* decides how you fight and what you learn fastest.',
        ],
        see: ['new-hero', 'skills'],
        special: 'races',
      },
      {
        id: 'magic',
        title: 'Magic and powers',
        icon: '✦',
        summary: 'Spells, books, mana and powers.',
        keywords: 'magic spell cast school book mana fail failure power powers again device wand',
        body: [
          'Spells are written in books and belong to schools: Mana, Fire, Water, Air, Earth, Nature, Conveyance, Divination, Temporal, Mind, Meta and more. Your skill in a school decides which of its spells you can cast and how well.',
          '*Cast* opens your magic: what you used recently first, then every spell in the books you carry. Tap ⓘ beside a spell to read what it does. *Again* on the toolbar repeats your last spell at the nearest foe.',
          'Each spell costs mana and may fail; both get better as your skill grows. A spell you lack the mana for is refused, unless you choose *Try anyway*, a risky attempt.',
          '*Powers* are gifts of your race, your class or what has changed you. They are in the same place, or under *Powers* if you carry no books.',
          'Some classes have magic of their own: songs, mindcraft, necromancy, thaumaturgy and others.',
          'Wands, staffs and rods let anyone use magic; skill with magic devices makes them work better.',
        ],
        see: ['gods', 'skills'],
      },
      {
        id: 'gods',
        title: 'Gods and piety',
        icon: '☼',
        summary: 'Following one of the Valar.',
        keywords: 'god gods piety pray prayer valar eru manwe tulkas yavanna melkor altar',
        body: [
          'Priests must follow a god; any hero may choose one when they begin, or later at an altar.',
          'Your *piety* is how pleased your god is: it rises and falls with what you do. *Pray* (under More) calls on your god, bringing some of their gifts into play. Prayers are spells your god grants: they cost piety instead of mana, and grow with your Prayer skill.',
          {
            terms: [
              ['Eru Ilúvatar', 'The One. Grants wisdom and mana, and while you pray may turn aside evil blows. Wants blunt or blessed weapons, and no good creatures harmed.'],
              ['Manwë Súlimo', 'Lord of the winds. Grants levitation, and while you pray, speed, free action and flight. Piety slowly fades.'],
              ['Tulkas', 'The champion. Grants strength and toughness, and loves evil and demons slain while you pray.'],
              ['Yavanna Kementári', 'Giver of Fruits. Lets you pass through trees and heal on grass; never harm animals while you pray.'],
              ['Melkor Bauglir', 'The Dark Enemy. Grants strength and fire resistance for a little of your mind. Piety drains quickly.'],
            ],
          },
          'All but Melkor abandon a hero who wears the One Ring.',
        ],
        see: ['magic'],
      },
      {
        id: 'new-hero',
        title: 'Making a new hero',
        icon: '✚',
        summary: 'Race, class, and the choices before you begin.',
        keywords: 'new character creation birth create race class name random back options quests fates small levels',
        body: [
          'Choose a race, a race modifier, a class and its specialisation (and for some, a god), then name your hero. *Back* steps back a choice; *Random* highlights one for you to take or change.',
          'Last comes *Ready to begin?*: the hero you have made, and how your adventure is set up. These can only be chosen now:',
          {
            terms: [
              ['Random quests', 'How many random quests wait in the dungeons: none, 10, 20, 40 or 60.'],
              ...Object.values(RUN_OPTION_TEXT).map(({ label, detail }): [string, string] => [label, detail]),
            ],
          },
          { tip: 'For a first hero, try a Wood-Elf Archer, a Troll Unbeliever or a Half-Ogre Warrior: tough, simple and strong from the start.' },
        ],
        see: ['races', 'first-steps'],
      },
    ],
  },
  {
    title: 'The game',
    topics: [
      {
        id: 'quests',
        title: 'Quests',
        icon: '!',
        summary: 'People who need your help.',
        keywords: 'quest quests random reward task mission princess sword adventurer',
        body: [
          'Your great quest is set from the start. Beyond it, people in the towns ask for help: walk into their buildings to hear what they need. Some quests take you to a level of their own.',
          '*Random quests* wait at set depths of the main dungeons (the Barrow-Downs, Mirkwood, Mordor and Angband), spread evenly from the top to the bottom: with 20 of them, one about every five levels. Each is a captured princess, guarded by creatures stronger than the depth, or an adventurer whose sword a band of them took.',
          'When you arrive on a quest level a banner names the quest, its music plays, and the edges of the map glow violet for as long as it waits, more strongly while the creatures it is after are in sight. A ⚑ chip below your hero keeps the count (tap it to read what the quest asks), and those creatures are marked ⚑ among the others. Leave the level and the quest is there on your next visit, begun again.',
          'Save the princess and she offers a choice of rewards; win back the sword and the adventurer offers to join you, or teaches you a skill.',
          'Menu → Knowledge → *Quests* lists what you have taken on, and what is done.',
        ],
        see: ['welcome', 'knowledge'],
      },
      {
        id: 'knowledge',
        title: 'Knowledge and messages',
        icon: '¶',
        summary: 'What you have learnt, and what was said.',
        keywords: 'knowledge artifacts uniques kills recall depths corruptions companions quests fates notes messages log history',
        body: [
          'Menu → *Knowledge* holds what your hero has learnt: artifacts found, unique creatures, kills, recall depths, corruptions, companions, quests, fates, dungeon towns and your notes.',
          'The latest messages show above the map and fade as you play. Tap them, or Menu → *Messages*, for the whole log. Our own notes (why you stopped, deeds earned) are there too, in gold.',
          'Settings → Messages: *Flow past* never waits on a message; *Pause at each* waits for a tap.',
        ],
        see: ['quests', 'deeds'],
      },
      {
        id: 'deeds',
        title: 'Deeds and the Hall of Fame',
        icon: '★',
        summary: 'Your tale, remembered.',
        keywords: 'deeds achievements chronicle hall of fame score death fallen tale abandoned begin anew remove',
        body: [
          'Great moments earn *deeds*, shown as they happen. Your chronicle keeps your kills, the legends you have slain, your deepest descent and your closest calls.',
          'When a hero falls, or you abandon their adventure, their tale goes into the *Hall of Fame* (also on the title screen), with their gear, skills and last moments. Tap a hero there for *Begin anew*, *Look back* and, on the title screen, *Remove*.',
          '*Begin anew* starts a new adventure with the same race, class and attributes, under a name of its own: *Elder* begun anew is *Elder II*, then *Elder III*. Each run is a hero of its own, with its own saved game and place in the Hall of Fame.',
        ],
        see: ['survival'],
      },
      {
        id: 'saving',
        title: 'Saving and backups',
        icon: '⇩',
        summary: 'Saving, backups and moving to another device.',
        keywords: 'save saving load continue export import backup device browser quit delete abandon heroes adventurers',
        body: [
          'The game saves when you leave the app. Menu → *Save game* saves now; *Save and quit* saves and returns to the title.',
          'On the title screen *Continue* takes you straight back into your last hero\'s game; *Roster* lists every saved hero. Tap a hero there for *Play* or *Delete*.',
          'Menu → *Abandon adventure* ends the current adventure for good. It is remembered in the Hall of Fame, where you can begin anew with the same hero.',
          'Everything is kept in this browser. *Backup* on the title screen exports all of it (every hero, the Hall of Fame, your deeds) as one file, and imports it again, here or on another device.',
          'Clearing this site’s data in your browser deletes your games: export them first.',
          'Add the game to your home screen to play full screen, even offline.',
        ],
        see: ['settings'],
      },
      {
        id: 'settings',
        title: 'Settings',
        icon: '⚙',
        summary: 'Text size, sound, animation, pace and more.',
        keywords: 'settings options text size font music sound volume animation messages exploring pace dungeon levels map symbols zoom',
        body: [
          'Menu → *Settings*, or Settings on the title screen:',
          {
            terms: [
              ['Text size', 'One size for all the game’s text.'],
              ['Music, Sound effects', 'Each place has its own theme; combat, doors and magic have their sounds.'],
              ['Animation', 'Full, reduced or none: moving creatures, bolts and effects.'],
              ['Messages', 'Let them flow past, or pause at each.'],
              ['Exploring', 'The pace of Explore and travel.'],
              ['Dungeon levels', 'Kept as you left them, or new each visit. Towns and the land are always remembered.'],
              ['Map symbols', 'Shaded symbols, or classic letters.'],
              ['Map zoom', 'How close the map is; pinching does the same.'],
            ],
          },
          'The classic ToME options (More → Options) are there for those who know them.',
        ],
        see: ['saving'],
      },
    ],
  },
  {
    title: 'Reference',
    topics: [
      {
        id: 'manual',
        title: 'The original ToME manual',
        icon: '❡',
        summary: 'The classic reference, in full: spell schools, classes, gods and spoilers.',
        keywords: 'manual reference spoiler classic original tome help files',
        body: [
          'The manual that came with ToME: every spell school, class, race and god in detail, the dungeons, and spoilers. It is written for the original game and its keys, so some of it does not apply here.',
        ],
        special: 'manual',
      },
    ],
  },
];

/** Every topic, in order. */
export const TOPICS: readonly HelpTopic[] = HELP.flatMap((g) => g.topics);

export function findTopic(id: string): HelpTopic | null {
  return TOPICS.find((t) => t.id === id) ?? null;
}

/** Lower case without accents or *markup*, for matching. */
export function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[*’]/g, (c) => (c === '’' ? "'" : ''))
    .toLowerCase();
}

function blockText(block: HelpBlock): string {
  if (typeof block === 'string') return block;
  if ('heading' in block) return block.heading;
  if ('tip' in block) return block.tip;
  if ('terms' in block) return block.terms.flat().join(' ');
  return ('list' in block ? block.list : block.steps).join(' ');
}

/* Words a question is made of rather than about. */
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'get', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your']);

/** Topics with a word starting with each word of the query (but those a question is made of), best first: by title, then keywords and summary, then the text. */
export function searchHelp(query: string): HelpTopic[] {
  const words = plain(query)
    .split(/[^a-z0-9'-]+/)
    .filter((w) => w && !STOP_WORDS.has(w));
  if (!words.length) return [];
  const scored: [HelpTopic, number][] = [];
  for (const topic of TOPICS) {
    const title = plain(topic.title);
    const tags = plain(`${topic.keywords ?? ''} ${topic.summary}`);
    const text = plain(topic.body.map(blockText).join(' '));
    let score = 0;
    for (const word of words) {
      const starts = new RegExp(`(?:^|[^a-z0-9])${word.replace(/[-']/g, '\\$&')}`);
      const s = starts.test(title) ? 4 : starts.test(tags) ? 2 : starts.test(text) ? 1 : 0;
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score) scored.push([topic, score]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([topic]) => topic);
}
