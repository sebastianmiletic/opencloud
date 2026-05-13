# UI Components

The UI is built entirely with vanilla JavaScript and CSS. No frameworks.

## Theme

- **Colors**: Pure black/white grayscale. No colors.
- **Font**: Inter (Google Fonts)
- **Icons**: Font Awesome 6
- **CSS Variables**: Defined in `:root` for consistent theming

## Layout

### Header
- Logo (clickable → navigates to Home)
- Search input (debounced 300ms)
- Account dropdown (switch/add/manage accounts)
- Settings button

### Navigation
- Home, Collection tabs
- Active tab highlighted with underline

### Splash Screen
- Netflix-style animated intro
- Logo fades in, progress bar fills, then reveals app
- Duration: ~3.2 seconds

## Search

- Debounced input (300ms)
- Searches TMDB `/search/multi`
- Results show poster, title, year, rating, type
- Actions: Watch Now, Add to Collection
- OMDB ratings fetched in batch for results

## Category Rows

Horizontal scrolling rows on Home:
- Popular, Now Playing, Top Rated
- Comedy, Action, Horror, Sci-Fi
- Star Wars Saga
- Based on Your Collection (recommendations)

Each card shows poster, rating, title, year.

## Item Modal

Opens when clicking any movie/show:
- Backdrop image
- Poster, title, year, rating, type
- Genre tags
- Overview
- **Watch Now** button → opens inline player
- **Add to Collection** button → saves to Collection

## Hero Carousel

- Clone-based seamless infinite loop
- 5 featured popular movies
- Auto-advances every 12 seconds
- Progress bar timer synchronized with slide
- Pause on hover
- Click content → open modal
- Actions: Watch Now, Add to Collection

## Collection Grid

- Sort by: date, title, rating
- Actions per item: Watch Now, Delete
- Delete uses in-app confirm modal

## Toast Notifications

- Success (green check)
- Error (red exclamation)
- Info (blue info circle)
- Auto-dismiss after 3 seconds
- Slide-in from right animation

## Confirm Modal

Replaces browser `confirm()` dialogs:
- Warning icon
- Title + message
- Cancel / Confirm buttons
- Dismissible via overlay click, Escape, or Enter
- Returns Promise<boolean>

## Empty States

Collection shows a friendly empty state with icon and guidance text when no items exist.
