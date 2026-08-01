/* ==========================================================================
   model/schema.js
   --------------------------------------------------------------------------
   The shape of a Nashr-e Asb document, in one place.

   CATEGORIES is a transcription of CATEGORY_CONFIG in build.py. It is written
   out by hand because the studio runs in a browser and cannot import Python -
   which means the two CAN drift. Whenever a category is added to build.py it
   must be added here in the same commit. There is no clever way around that,
   only discipline, so the list is kept short and obvious.

   FIELD_ORDER controls the order new frontmatter keys are written in. Keys
   already present in a file keep their original position and their original
   formatting; this order only applies to keys the studio adds.

   This module must never touch the DOM.
   ========================================================================== */

/**
 * slug -> Persian label.
 *
 * This is the FALLBACK. The live list is read from data/categories.json,
 * which build.py writes straight out of CATEGORY_CONFIG - see
 * loadCategories() below. Keeping a copy here means the studio still works
 * offline, and on the very first run before that file has been copied over.
 */
export const CATEGORIES = {
  'novel': 'رمان',
  'short-story/single': 'تک‌داستان کوتاه',
  'short-story/collection': 'مجموعه‌داستان کوتاه',
  'flash-fiction/single': 'تک‌داستان برق‌آسا',
  'flash-fiction/collection': 'مجموعه‌داستان برق‌آسا',
  'non-fiction/essay/single': 'تک‌جستار',
  'non-fiction/essay/collection': 'مجموعه‌جستار',
  'non-fiction/article/single': 'تک‌مقاله',
  'non-fiction/article/collection': 'مجموعه‌مقاله',
  'magazine': 'مجله‌ی اسب',
  'creators': 'پدیدآورندگان',
};

/* Legacy category strings build.py still auto-corrects. The studio reports
   them so a file can be migrated once instead of translated forever. */
export const LEGACY_CATEGORIES = {
  'essay/single': 'non-fiction/essay/single',
  'essay/collection': 'non-fiction/essay/collection',
  'essay': 'non-fiction/essay/single',
  'flash-fiction': 'flash-fiction/single',
  'short-story': 'short-story/single',
};

/**
 * Replaces the built-in list with the one build.py exported, when it is there.
 *
 * The browser cannot read Python, so these two CAN drift - and the only way
 * to stop that is to have the Python side publish the list and the studio
 * read it, rather than trusting anyone to remember to edit both.
 *
 * Called once at boot. A missing file is not an error: the built-in list
 * simply stands.
 */
export async function loadCategories() {
  try {
    const response = await fetch('data/categories.json', { cache: 'no-cache' });
    if (!response.ok) return { source: 'built-in', count: Object.keys(CATEGORIES).length };

    const data = await response.json();
    if (!data || typeof data !== 'object') return { source: 'built-in', count: Object.keys(CATEGORIES).length };

    const incoming = data.categories || data;
    if (Object.keys(incoming).length === 0) return { source: 'built-in', count: Object.keys(CATEGORIES).length };

    for (const key of Object.keys(CATEGORIES)) delete CATEGORIES[key];
    Object.assign(CATEGORIES, incoming);

    return { source: 'build.py', count: Object.keys(CATEGORIES).length, generated: data.generated || null };
  } catch {
    return { source: 'built-in', count: Object.keys(CATEGORIES).length };
  }
}

export const LANGUAGES = { fa: 'فارسی', en: 'انگلیسی' };

/* Block colour classes the site stylesheet defines. Applied as attribute-list
   classes on the paragraph - never as a <span>, which is presentation
   smuggled into the manuscript and unreadable to every tool that follows. */
export const BLOCK_COLOURS = {
  '': 'بدون رنگ',
  'color-ochre': 'اخرایی',
  'color-blue': 'آبی',
  'color-red': 'قرمز',
  'color-gray': 'خاکستری',
  'color-white': 'سفید',
};

/* Every key the sidebar renders a control for. Anything NOT in this list is
   still read, still written, and still shown to the author as preserved -
   it simply has no dedicated input. */
export const KNOWN_FIELDS = [
  'book_id', 'title', 'slug', 'author', 'translator', 'editor',
  'category', 'series', 'language', 'reader', 'premium', 'price',
  'date', 'cover', 'image', 'tags', 'summary',
];

/* --------------------------------------------------------------------------
   The canonical frontmatter block

   Every saved work carries these keys, in this order, whether or not they
   have a value. Two reasons:

     - a file you can read at a glance, because the fields are always in the
       same place
     - a diff that shows what actually changed, instead of a block reshuffling
       itself every time a field is added

   DEFAULTS MATTER MORE THAN THEY LOOK. Empty text is written as "" and never
   as null, because build.py does post.get('author', '').strip() - and .strip()
   on None raises, which the outer try/except swallows, and the whole file is
   then skipped from the build without a word. `series` is the exception:
   build.py reads it without .strip(), and null is what it expects.
   -------------------------------------------------------------------------- */

export const FIELD_ORDER = [
  'book_id', 'title', 'slug',
  'author', 'translator', 'editor',
  'category', 'series', 'language',
  'reader', 'premium', 'date',
  'cover', 'tags',
];

export const FIELD_DEFAULTS = {
  book_id: () => newBookId(),
  title: () => '',
  slug: () => '',
  author: () => '',
  translator: () => '',
  editor: () => '',
  category: () => 'short-story/single',
  series: () => null,
  language: () => 'fa',
  reader: () => false,
  premium: () => false,
  date: () => todayJalali(),
  cover: () => '',
  tags: () => [],
};

/* Creator profiles get the same treatment in their own order. */
export const CREATOR_ORDER = ['name', 'slug', 'image', 'roles', 'socials'];

export const CREATOR_DEFAULTS = {
  name: () => '',
  slug: () => '',
  image: () => '',
  roles: () => [],
};

/* Rough Jalali date for today, so a new file is not stamped 1400-01-01.
   Good to the day, which is all a publication date needs. */
export function todayJalali() {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (type) => (parts.find((x) => x.type === type) || {}).value || '';
    const year = get('year').replace(/[^0-9]/g, '');
    return `${year}-${get('month')}-${get('day')}`;
  } catch {
    return '';
  }
}

/* --------------------------------------------------------------------------
   Creator profiles

   A different shape entirely: a person, not a work. build.py reads exactly
   these five keys plus the body, which becomes the biography.
   -------------------------------------------------------------------------- */

export const CREATOR_FIELDS = ['name', 'slug', 'image', 'roles', 'socials'];

/* The roles the site shows under a name. Free text is allowed too - this list
   is a set of suggestions, not a fence. */
export const CREATOR_ROLES = [
  'نویسنده', 'مترجم', 'ویراستار', 'شاعر',
  'تصویرگر', 'گردآورنده', 'بازنویس', 'مصحح', 'طراح جلد',
];

/* Networks a profile can link to. `label` is what the form calls it; the key
   is what goes into the file. */
export const SOCIAL_NETWORKS = {
  website: { label: 'وب‌سایت', placeholder: 'https://example.com' },
  x: { label: 'ایکس', placeholder: 'https://x.com/username' },
  telegram: { label: 'تلگرام', placeholder: 'https://t.me/username' },
  instagram: { label: 'اینستاگرام', placeholder: 'https://instagram.com/username' },
  linkedin: { label: 'لینکدین', placeholder: 'https://linkedin.com/in/username' },
  goodreads: { label: 'گودریدز', placeholder: 'https://goodreads.com/author/…' },
  email: { label: 'ایمیل', placeholder: 'name@example.com' },
};

export const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** Structural markers build.py splits the document on. */
export const MARKERS = {
  ereader: '<!-- EREADER-START -->',
  paywall: '<!-- PAYWALL -->',
};

/** Generates a v4 UUID for book_id, the same shape build.py expects. */
export function newBookId() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for older browsers; still a valid v4 layout.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Turns a Persian title into a safe latin-ish slug suggestion. */
export function suggestSlug(title) {
  return String(title || '')
    .trim()
    .replace(/[\s\u200c]+/g, '-')
    .replace(/[^\w\u0600-\u06FF-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}
