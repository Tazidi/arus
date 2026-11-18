(() => {
  let choice;
  const media = matchMedia('(prefers-color-scheme: dark)');
  function readChoice() {
    try { choice = localStorage.getItem('arus:theme'); } catch {}
  }
  function apply() {
    const theme = choice === 'light' || choice === 'dark' ? choice : media.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#1b1b19' : '#e8dfce';
  }

  readChoice();
  apply();
  media.addEventListener('change', apply);
  window.addEventListener('arus:theme', event => { choice = event.detail; apply(); });
  window.addEventListener('storage', event => { if (event.key === 'arus:theme' || event.key === null) { readChoice(); apply(); } });
})();
