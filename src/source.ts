/**
 * What a project sent for building carries: the project as its repository
 * holds it.
 *
 * The build starts from a clean copy of the project, so what a clean copy
 * would not hold stays behind: `node_modules`, which the build installs, and
 * whatever the project's `.gitignore` lists, which the project itself marks as
 * generated. Dot files stay behind too, by the junk filter, as for every
 * upload.
 *
 * The first reason is which site gets published, not size. An old `dist/`
 * beside the source can be found by the build service's output search before
 * the folder the build just wrote, and published in its place. Leaving it out
 * also keeps the upload the size of the source, and keeps a file the project
 * keeps out of git (a key, a service account) on the person's machine. The
 * cost is the one a clean CI checkout has: an app that imports an ignored file
 * fails its build, and the build names the file.
 *
 * `.gitignore` is read the way git reads it. The matching is the `ignore`
 * package's, which follows git's rules, "a file cannot be re-included if its
 * parent folder is excluded" among them. It reads one set of patterns, while
 * git reads each `.gitignore` from its own folder, so every file's patterns
 * are rewritten to the root of the drop and added shallowest first: a deeper
 * file then wins, as it does in git. `tests/source.test.ts` holds the result
 * to git itself.
 *
 * Matching ignores case, as git does on the Mac and Windows machines these
 * projects are made on. What git alone can see is not read: its index (a file
 * committed despite `.gitignore` is left out) and `.git/info/exclude`, which
 * no clean copy carries.
 */
import ignore from 'ignore';
import { filePath } from './files';

/** A file's path as segments, whatever separator the browser or archive used. */
function segments(file: File): string[] {
  return filePath(file).replace(/\\/g, '/').split('/').filter(Boolean);
}

/**
 * One `.gitignore` line, rewritten from its own folder to the root of the drop.
 * Null for a line that holds no pattern.
 *
 * A pattern with no slash but a trailing one matches at any depth below its
 * folder; any other slash, a leading one included, anchors it to the folder.
 */
export function rebase(line: string, base: string): string | null {
  // Trailing spaces end a pattern unless a backslash escapes the last one.
  // No lookbehind: Safari parses one only from 16.4, and a bundle carrying one
  // fails to load before that.
  const pattern = line.replace(/(\\ )? *$/, (_, escaped: string | undefined) => escaped ?? '');
  if (pattern === '' || pattern.startsWith('#')) return null;
  if (base === '') return pattern;

  // The folder is a literal path, never a pattern: a name such as `[slug]`,
  // `#1-app` or `!important` would otherwise be read as glob syntax.
  const folder = base.replace(/[\\*?[\]]/g, '\\$&').replace(/^[#!]/, '\\$&');
  const negated = pattern.startsWith('!');
  let body = negated ? pattern.slice(1) : pattern;
  const directoryOnly = body.endsWith('/');
  if (directoryOnly) body = body.slice(0, -1);
  // A line such as `!` or `/` names nothing, and git reads it as no pattern.
  // Rewritten, it would name the whole folder.
  if (body.replace(/^\//, '') === '') return null;

  const rebased = body.includes('/')
    ? `${folder}/${body.replace(/^\//, '')}`
    : `${folder}/**/${body}`;
  return `${negated ? '!' : ''}${rebased}${directoryOnly ? '/' : ''}`;
}

/**
 * The files of a project sent for building, without `node_modules` and
 * without whatever its `.gitignore` files list. Paths are read as dropped,
 * before the common folder is stripped, so each `.gitignore` applies from its
 * own folder whether the person dropped the repository, a folder holding it,
 * or a folder inside it.
 */
export async function projectSource(files: File[]): Promise<File[]> {
  // The folder picker hands `node_modules` over whole; it never reaches the
  // matcher.
  const source = files.filter((file) => !segments(file).includes('node_modules'));

  const rules = source
    .map((file) => ({ file, parts: segments(file) }))
    .filter(({ parts }) => parts.at(-1) === '.gitignore')
    .sort((a, b) => a.parts.length - b.parts.length);
  if (rules.length === 0) return source;

  const matcher = ignore({ allowRelativePaths: true });
  for (const { file, parts } of rules) {
    const base = parts.slice(0, -1).join('/');
    // A line break ends a pattern and gitignore cannot escape one, so a folder
    // named with one cannot be written into its rules. Refused rather than
    // matched wrongly: wrongly means its private files are sent.
    if (/[\r\n]/.test(base)) {
      throw new Error(
        "A folder in this project has a line break in its name, so its .gitignore can't be read. Rename the folder, then try again.",
      );
    }
    // Git skips a byte order mark and reads CRLF line endings as LF.
    const text = (await file.text()).replace(/^\uFEFF/, '');
    for (const line of text.split(/\r?\n/)) {
      const pattern = rebase(line, base);
      if (pattern !== null) matcher.add(pattern);
    }
  }
  return source.filter((file) => !matcher.ignores(segments(file).join('/')));
}
