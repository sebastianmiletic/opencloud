# Multi-Account System

Open Cloud supports multiple user profiles with fully isolated data.

## Getting Started

No default accounts are provided. When the app first loads, the user must create their own account via the account dropdown.

## Data Isolation

Each account has its own localStorage keys:

```
openccloud_user_{name}_usercollection  → Collection
```

Switching accounts reloads the current tab with that account's data.

## Account Dropdown

- Shows all accounts with avatars (first letter)
- Checkmark indicates current account
- Click to switch

## Adding Accounts

- Click "Add Account" in dropdown
- Enter name in modal
- Validates uniqueness
- Creates empty profile immediately
- If it's the first account created, auto-switches to it

## Removing Accounts

- Click "Manage Accounts" in dropdown
- Shows all accounts with collection counts
- Remove button with in-app confirm
- Cannot delete the last remaining account
- Removing current account → switches to first available account

## Account Switch Safety

Switching accounts force-closes all overlays to prevent state confusion:
- Player
- Item Modal
- Episode Popover
- Settings Modal
- Manage Accounts Modal
- Add Account Modal
- Confirm Modal
