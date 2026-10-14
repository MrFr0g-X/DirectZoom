// Latest-release lookup for builds that can't self-update (portable). No Electron imports, so it
// can be unit-tested.

/** True when version `a` is newer than `b` (major.minor.patch; a leading "v" is ignored). */
function newer(a, b) {
  const parse = v => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map(x => (/^\d+$/.test(x) ? Number(x) : 0));
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** Version of the repository's latest published (non-draft, non-prerelease) release. */
async function latestRelease({ owner, repo }, userAgent) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': userAgent },
  });
  if (!response.ok) throw new Error(`${response.status}`);
  const release = await response.json();
  return String(release.tag_name ?? '').replace(/^v/, '');
}

module.exports = { newer, latestRelease };
