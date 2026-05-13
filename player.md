# Video Player

The player opens as an inline overlay (not a new page) with scale/fade animations.

## Opening

- `openPlayer(id, type, season, episode)` called from UI
- Overlay scales up from center with opacity fade
- Body scroll is locked
- Escape key closes player

## Movie Playback

- Loads provider iframe with movie ID
- Next/Episode buttons hidden
- Title shows movie name

## TV Playback

- Loads provider iframe with show ID + season + episode
- Fetches season/episode data from TMDB
- **Next Episode** button if another episode exists
- **Episodes** button opens episode picker popover

## Episode Picker

- Tab bar for each season
- Lists all episodes with number, name, air date, runtime
- Current episode highlighted
- Click episode → switch to it
- Back button returns to season list

## Provider Selection

The active provider is read from settings. URL templates use `{id}`, `{season}`, `{episode}` placeholders which are replaced at runtime.

## Closing

- Plays reverse scale/fade animation
- Clears iframe src (stops video)
- Unlocks body scroll
- Resets player state
