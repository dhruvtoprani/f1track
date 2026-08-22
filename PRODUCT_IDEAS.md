# Product Improvement Funnel

Ten ideas were evaluated against five criteria: user value, differentiation, trust, implementation fit, and sharing potential. Each score is out of five; the total is out of 25.

| Idea | Value | Distinctive | Trust | Feasible | Viral | Total |
|---|---:|---:|---:|---:|---:|---:|
| Winner model read: explain why the leader is favored | 5 | 5 | 5 | 5 | 4 | **24** |
| Strategy Lab: alter one team's race approach and compare it with baseline | 5 | 5 | 5 | 4 | 4 | **23** |
| Shareable circuit + forecast card with result, reasons, and scenario impact | 4 | 4 | 4 | 5 | 5 | **22** |
| Shareable circuit links that recreate a drawing and settings | 4 | 4 | 4 | 4 | 5 | 21 |
| Upset radar for the strongest low-grid contender | 4 | 4 | 4 | 4 | 3 | 19 |
| Head-to-head driver duel mode | 4 | 3 | 4 | 4 | 4 | 19 |
| Community circuit gallery and remix flow | 4 | 4 | 3 | 2 | 5 | 18 |
| Forecast leagues with weekly scoring | 4 | 4 | 3 | 2 | 5 | 18 |
| Weekly official-race forecast | 3 | 3 | 3 | 3 | 4 | 16 |
| Live co-simulation rooms | 3 | 5 | 2 | 1 | 5 | 16 |

## One-at-a-time elimination

1. **10 → 9: Live co-simulation rooms removed.** High novelty, but accounts, synchronization, moderation, and hosting cost do not improve the core forecast yet.
2. **9 → 8: Weekly official-race forecasting removed.** It shifts the product away from fictional-circuit exploration and creates a recurring data-operations commitment.
3. **8 → 7: Forecast leagues removed.** A scoring system needs user identity, persistence, anti-cheat rules, and a real event calendar before it becomes trustworthy.
4. **7 → 6: Community circuit gallery removed.** It is promising, but storage, moderation, discovery, and ownership are larger than the current product boundary.
5. **6 → 5: Head-to-head duel mode removed.** It is entertaining, but the existing probability table already supports comparison; it adds less explanatory value than the remaining ideas.
6. **5 → 4: Upset radar removed.** Its best insight—why a surprising driver is competitive—fits naturally inside the broader winner explanation system.
7. **4 → 3: Shareable circuit links removed.** URL serialization remains valuable future work, but a generated circuit + forecast card creates a complete sharing loop immediately without exposing a large encoded circuit payload.

## Selected releases

### 1. Winner model read

The result now explains the leader through three concrete, human-readable signals: starting control, track-conditioned package rank, and execution/finish strength. The copy explicitly calls these modeled edges rather than causal proof.

### 2. Paired Strategy Lab

Before running the forecast, a user can choose a team and apply an early undercut, tyre-preservation, or maximum-attack intervention. The app runs a baseline and intervention with the same qualifying grid, seed, and random race worlds. The result reports the selected team's baseline win probability and the isolated percentage-point change.

### 3. Shareable circuit + forecast card

The result generates a 1200×630 image containing the exact authored circuit, leader, probability, modeled win count, top three, conditions, explanation signals, strategy impact, sample ID, and product link. Supported devices share the PNG through the platform sheet; the fallback downloads it and copies the caption.

## Supporting quality pass

The release also removes unrelated launch-strip claims, fixes sample-count labels that previously said 10,000 even when a smaller sample was selected, adds skip navigation, complete tab semantics and arrow-key behavior, labeled progress indicators, visible focus treatment, larger touch targets, higher-contrast secondary text, readable microcopy, reduced-motion support, a repository link, share status announcements, and a real favicon.
