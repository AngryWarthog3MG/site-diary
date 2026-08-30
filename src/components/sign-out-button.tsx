'use client';

/**
 * Signing out has to take the cached pages with it. The service worker caches
 * navigation responses so the app opens offline, and those pages carry the
 * supervisor's own project data — leaving them behind on a shared phone would
 * show the next person the last person's diary.
 */
export function SignOutButton() {
  return (
    <form
      action="/auth/signout"
      method="post"
      onSubmit={() => {
        if ('caches' in window) {
          void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
        }
      }}
    >
      <button className="button button--quiet" type="submit">
        Sign out
      </button>
    </form>
  );
}
