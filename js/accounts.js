/** Account System – Supabase Only */
import { getCurrentAuthUser } from './auth.js';
import { showToast } from './utils.js';

export function initUser() {
  const user = getCurrentAuthUser();
  const avatar = document.getElementById('accountAvatar');
  const name = document.getElementById('accountName');
  const dropdownAvatar = document.getElementById('dropdownUserAvatar');
  const dropdownName = document.getElementById('dropdownUserName');
  const displayName = user?.user_metadata?.username || user?.email?.split('@')[0] || 'User';

  if (name) name.textContent = displayName;
  if (avatar) {
    avatar.textContent = displayName.charAt(0).toUpperCase();
    avatar.style.background = 'var(--text-primary)';
    avatar.style.color = 'var(--bg-primary)';
  }
  if (dropdownName) dropdownName.textContent = displayName;
  if (dropdownAvatar) dropdownAvatar.textContent = displayName.charAt(0).toUpperCase();
}
