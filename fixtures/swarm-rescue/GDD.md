# Swarm Rescue — Game Design Document

> Version 0.3 (fixture). Mobile action game for a US audience. Numbers marked **[ASSUMED]** are
> placeholders that have not been decided by the design team; GameX Engine should record them with
> `status: "assumed"` and raise a gap for each.

## 1. Overview

### 1.1 Pitch

Rogue drone swarms have taken over the city. The player is a rescue operative with a wrist laser
gauntlet who shoots drone swarms across city districts, saves trapped civilians, and finally takes
down the swarm's command unit — a boss — at Grand Central Intersection.

### 1.2 Platform and audience

- Platforms: iOS and Android phones (portrait, one-thumb aiming).
- Target market: United States, ages 13+ (see open questions about age rating).
- Session target: 3–6 minutes; 2–4 sessions per day for a typical player **[ASSUMED]**.

### 1.3 Guiding rule

**No UI ads during live gameplay.** While a mission is being played (gameplay and boss fight
screens), no banner, interstitial, MREC or rewarded prompt may be shown. In-world billboards on city
buildings are the only advertising allowed during gameplay; they never pause, cover, or interrupt play.

## 2. Heroes

Two launch heroes are selectable on the Home screen. They have **identical controls and identical
stats**; the choice is cosmetic. Both use the wrist laser gauntlet.

| Hero        | Role             | Weapon               | Stats               |
| ----------- | ---------------- | -------------------- | ------------------- |
| Relickeeper | Rescue operative | Wrist laser gauntlet | Same as Vanguard    |
| Vanguard    | Rescue operative | Wrist laser gauntlet | Same as Relickeeper |

Base hero stats **[ASSUMED]**: 100 HP, laser damage 10 per shot, fire rate 4 shots per second.

## 3. Enemies

- **Swarm drone** — basic flying enemy, arrives in waves. 20 HP **[ASSUMED]**, deals 5 damage on contact **[ASSUMED]**.
- **Swarm command unit (boss)** — appears only in Level 5. Three phases **[ASSUMED]**, 1500 HP total **[ASSUMED]**.

## 4. World and levels

### 4.1 Campaign levels

| Level | Name                        | Notes                                   |
| ----- | --------------------------- | --------------------------------------- |
| L1    | Downtown Avenue             | Tutorial level                          |
| L2    | Midtown Intersection        |                                         |
| L3    | Burning Boulevard           | Interstitials become possible from here |
| L4    | Financial District at Night |                                         |
| L5    | Grand Central Intersection  | Boss level                              |

Waves per level **[ASSUMED]**: L1 3, L2 4, L3 5, L4 6, L5 6 plus the boss.

### 4.2 Hub areas (menus)

- **Safe Zone** — rescued civilians gather here; daily chest location.
- **HQ Rooftop** — hero preview and Armory entry.
- **Campaign Map** — choose the next district/level.

## 5. Screen flow (22 states)

| ID  | Screen                | Kind     | Notes                                                    |
| --- | --------------------- | -------- | -------------------------------------------------------- |
| S00 | Loading               | loading  | App start. No ads.                                       |
| S01 | Consent / Privacy     | menu     | First launch only.                                       |
| S02 | Home (hero select)    | menu     | Banner from Level 3+.                                    |
| S03 | HQ Rooftop            | menu     |                                                          |
| S04 | Safe Zone             | menu     |                                                          |
| S05 | Campaign Map          | menu     | Banner.                                                  |
| S06 | Mission Briefing      | menu     | Offers the laser trial (rewarded).                       |
| S07 | Laser Trial           | ad       | Rewarded video; grants a stronger laser for one mission. |
| S08 | Gameplay              | gameplay | Live play. No UI ads.                                    |
| S09 | Boss Fight            | gameplay | L5 only. Live play. No UI ads.                           |
| S10 | Kill-cam              | gameplay | Final-blow kill-cam on the last drone / boss.            |
| S11 | Victory (star reveal) | result   | MREC. Offers Claim 3x.                                   |
| S12 | Claim 3x              | ad       | Rewarded video; triples mission coins.                   |
| S13 | Interstitial          | ad       | Only after Victory → Continue (see §7.2).                |
| S14 | Defeat                | result   | MREC. Offers revive.                                     |
| S15 | Revive Offer          | ad       | Rewarded video; revive once per mission.                 |
| S16 | Armory / Upgrades     | meta     | Banner. Spend coins on upgrades.                         |
| S17 | Upgrade Reroll        | ad       | Rewarded video; reroll the offered upgrade.              |
| S18 | Daily Chest           | meta     | Free once a day; rewarded video for a free upgrade.      |
| S19 | Settings              | menu     | Banner.                                                  |
| S20 | Store / Remove Ads    | meta     | IAP: Remove Ads.                                         |
| S21 | Pause                 | overlay  | MREC / outstream video. Returns to the paused screen.    |

### 5.1 Main loops

- **Start:** S00 Loading → S01 Consent (first launch) → S02 Home. Later launches skip S01.
- **Play:** S02 Home → S05 Campaign Map → S06 Briefing → (optional S07 Laser Trial → S06) → S08 Gameplay.
  On L5, S08 Gameplay → S09 Boss Fight after the last wave.
- **Win:** last enemy defeated → S10 Kill-cam → S11 Victory → (optional S12 Claim 3x → S11) →
  Continue → (S13 Interstitial when eligible) → S05 Campaign Map with the next district unlocked.
- **Lose:** player HP reaches 0 → S14 Defeat → (optional S15 Revive Offer → back to S08/S09 at the same
  wave) → Retry → S06 Briefing, or Exit → S05 Campaign Map.
- **Pause:** from S08 or S09 → S21 Pause → Resume (back to the same screen) or Quit → S05 Campaign Map.
- **Meta:** S02 Home ↔ S03 HQ Rooftop ↔ S16 Armory (↔ S17 Reroll); S02 ↔ S04 Safe Zone ↔ S18 Daily Chest;
  S02 ↔ S19 Settings; S02 ↔ S20 Store.
- **Exit:** the app can be closed from any screen; nothing is shown on exit.

## 6. Mechanics

### 6.1 Core combat

Aim by dragging; the gauntlet fires automatically while a drone is targeted. Each wave spawns a
number of drones; clearing all waves (and the boss on L5) wins the mission. Civilians trapped in the
level are saved by clearing the drones around them.

### 6.2 Proposed mechanics

- **Combo multiplier** — consecutive kills without taking damage raise a score multiplier
  (+0.1x per kill, capped at 3x **[ASSUMED]**).
- **Near-miss slow-mo** — dodging a drone at the last moment triggers 1.5 s of slow motion **[ASSUMED]**.
- **Final-blow kill-cam** — the last kill of a mission plays a short kill-cam (S10).
- **Victory star reveal** — 1 to 3 stars based on HP remaining and civilians saved.
- **Daily chest** — once per day in the Safe Zone (see §8.3).

### 6.3 Upgrades

The Armory sells laser upgrades (damage, fire rate) in tiers 1–10. Upgrade cost per tier is not yet
decided: **[ASSUMED]** geometric, 100 coins at tier 1, ×1.5 per tier. Each damage tier adds +2 damage
**[ASSUMED]**. The Upgrade Reroll (S17) lets the player watch a rewarded video to reroll which upgrade
is offered at a discount.

## 7. Monetization

### 7.1 Rewarded video (main format)

| Placement                  | Screen  | Reward                                   | Limits                       |
| -------------------------- | ------- | ---------------------------------------- | ---------------------------- |
| Victory Claim 3x           | S11→S12 | Triples the mission's coin reward        | Once per victory             |
| Defeat revive              | S14→S15 | Revive at the current wave with full HP  | **Max 1 revive per mission** |
| Briefing laser trial       | S06→S07 | Stronger laser for the next mission only | Once per briefing            |
| Upgrade reroll             | S16→S17 | Reroll the discounted upgrade offer      | 3 per day **[ASSUMED]**      |
| Daily chest / free upgrade | S18     | One free upgrade tier                    | Once per day                 |

Rewards are granted only after the ad network confirms completion (server-side verification).

### 7.2 Interstitial

Interstitials follow strict pacing rules:

1. Shown **only after Victory → Continue** (S11 → S13).
2. Only **from Level 3 onward** (the mission just won is L3 or later).
3. **Max 1 per mission.**
4. **At least 180 seconds apart.**
5. **Never after a defeat.**
6. **Never on app open or app exit.**
7. Never during live gameplay (§1.3).

### 7.3 Banner

Shown on Home (only once the player has reached Level 3), Campaign Map, Armory, and Settings.
Never on gameplay, result, ad or pause screens.

### 7.4 MREC / outstream video

Shown on Pause, Victory, and Defeat.

### 7.5 In-world billboards

Billboards on city buildings inside levels may show ads. They are the only ads allowed during gameplay.

### 7.6 In-app purchases

- **Remove Ads** — removes banners, MRECs and interstitials. Rewarded videos stay available (opt-in).
  Price **[ASSUMED]** $3.99.

## 8. Economy

### 8.1 Currencies

- **Coins** (soft currency) — earned from missions and chests, spent on upgrades. Starting balance
  **[ASSUMED]** 0.
- No hard currency at launch.

### 8.2 Mission rewards

Coins per victory **[ASSUMED]**: 50 + 25 × level, plus 10 per civilian saved **[ASSUMED]**.
Defeat grants no coins.

### 8.3 Daily chest

Once per calendar day (player's local midnight reset). Contents **[ASSUMED]**: 100 coins, or one free
upgrade tier when opened with a rewarded video.

## 9. Open questions

- Will there be a **web build** (e.g. for playable ads or a browser version)?
- What is the **age rating**? Does **COPPA** apply (is the game directed at children under 13)?
- Which **ad mediation stack** will we use (e.g. which mediation platform and networks)?
- Will there be **IAP beyond Remove Ads** (coin packs, hero skins, a season pass)?
- What are the final **currency amounts and upgrade costs**?
