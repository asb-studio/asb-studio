# دفترچه‌ی همگام‌سازی استودیو با راهنمای نوشتن

تاریخ: ۱۴۰۵-۰۶-۰۳ · دامنه: کل استودیو · مرجع: `RAHNAMANEVESHTAN.md` + `build.py` + `freeze_ids.py` واقعی

این سند دقیقاً می‌گوید چه چیزی، چرا، و در کدام فایل عوض شد. هر بند با تست یا بازخوانی کد پایتون تأیید شده. چیزی که **انجام نشده** و منتظر اجازه‌ی توست، آخر سند جداست.

## فهرست

- **یک** — فرانت‌متر: هماهنگ کامل با راهنما
- **دو** — مارک‌دان تازه: `///`، واژه‌نامه، کوته‌نوشت، برجسته
- **سه** — نقل‌قول‌های خمیده (`Ctrl+Alt+1..4`)
- **چهار** — اصلاح باگ‌ها (پرش پانل، جهت پانویس، منابع، بریده، novelette)
- **پنج** — پایتون: پچ `freeze_ids.py` (دست‌نخورده؛ دستور دقیق)
- **شش** — ردیاب تغییرات: سه ریشه، هر سه بسته + اثبات
- **شش‌الف** — این دور: بریده انتخابی، حذف article، کلیدهای ردیف بالا، فهرست کشویی فضای مشترک
- **هفت** — وضعیت و تست
- **هشت** — محدودیت‌های شناخته‌شده
- **نه** — کارهای باز
- **پیوست** — CSS آماده‌ی جعبه‌ها برای سایت (`36-admonitions.css`)

---

## یک — فرانت‌متر: هماهنگ کامل با راهنما

| فایل | تغییر |
|---|---|
| `model/schema.js` | `FIELD_ORDER` = ترتیب ۲۹ خانه‌ای بخش دو راهنما (summary آخر). پیش‌فرض‌ها فقط ساختاری: book_id، category، language، reader، premium، date. `CREATOR_ORDER` حالا category را بعد از slug دارد. `KNOWN_FIELDS` کامل: section، issue، release_date/time، cover_caption، قیمت‌ها، hook، formats، summary_en. `MARKERS` جفتِ EXCERPT-START/END. `ADMONITION_KINDS` برای نُه نوع جعبه. **`novelette` به CATEGORIES اضافه شد** — درفت واقعی: build.py داشت، استودیو نداشت و قالب شماره ۴ را «تعریف‌نشده» می‌گرفت |
| `model/frontmatter.js` | `formatScalar` تاریخ (`1405-04-12`) و ساعت (`20:00`) را همیشه گیومه‌دار می‌نویسد — بدون گیومه، YAML آن‌ها را timestamp و عدد شصت‌گانی می‌بیند (release_time بدون گیومه خاموش خاموش می‌شود 20:00). متد `reformat(key)` برای به‌روز کردن خط بدون عوض کردن مقدار |
| `model/normalize.js` | بازنویسی: ۱) ترتیب راهنما؛ ۲) **کلید خالی هرگز** — build.py فایلِ کلید خالی را رد می‌کند، پس خالی‌های شناخته‌شده حذف می‌شوند (reader:false و premium:false جواب‌اند، نه خالی)؛ ۳) تاریخ‌های موجود هم گیومه می‌گیرند؛ ۴) فیلد ناشناخته دست‌نخورده. `previewNormalize` حالا `{added, removed, requoted, outOfOrder}` |
| `main.js` | گفت‌وگوی «مرتب کردن شناسنامه» با شکل تازه: اضافه‌ها، حذف‌ها، گیومه‌ها، ترتیب — و می‌پرسد |
| `ui/sidebar.js` | کارت‌های تازه: section، issue، release_date/time، cover_caption، summary_en، preorder_price، hook، formats، sale_price، sale_until، special_price. **شرطی**: فیلدهای پیش‌خرید فقط با release_date؛ قیمت‌ها فقط با premium (چرخش رندر با سوییچ premium و تغییر release_date) |
| `model/validate.js` | پیش‌خرید بدون premium → خطا (متن اصلاً رندر نمی‌شود)؛ قالب release_date/release_time/sale_until؛ sale_price ≥ price → هشدار (سیستم نادیده می‌گیرد)؛ تخفیف روی پیش‌خرید → هشدار؛ formats خالی در پیش‌خرید → هشدار |
| `markdown/lint.js` | خطای تازه‌ی `empty-frontmatter-key`؛ فهرست افزونه‌ها در سرصفحه به‌روز |
| `data/categories.json` | با CATEGORY_CONFIG پایتون هماهنگ شد (novelette اضافه) |

## دو — مارک‌دان تازه: `///`، واژه‌نامه، کوته‌نوشت، برجسته

| فایل | تغییر |
|---|---|
| `markdown/site-blocks.js` (تازه) | گشایش چهار قابلیت به HTML پیش از رندر: admonition (۹ نوع → ۳ رنگ)، details (با `open: true`)، فهرست تعریفی، کوته‌نوشت. بلوک کد و کد درون‌خطی مصون‌اند؛ بلوک نابسته دست‌نخورده رد می‌شود؛ خطوط خالی داخل HTML فشرده می‌شوند (markdown-it بلوک HTML را در اولین خط خالی می‌بندد) |
| `markdown/preview.js` | `expandSiteBlocks` بعد از علامت ردیاب، قبل از نشانه‌ها |
| `export/epub.js` | همان گشایش با رندرر XHTML + قلمرو CSS کتاب برای همه‌ی کلاس‌های راهنما (scene-break در کتاب = سفیدی، طبق راهنما) |
| `export/review-report.js` | همان گشایش در گزارش پدیدآورنده |
| `styles/preview.css` | pullquote، colophon، editor-note، small، mag-article-deck، story-deck، mark، scene-break (`* * *` اخرایی)، admonition سه‌رنگ، details، dl/dt/dd، abbr، سرآغاز اُخرایی بند اول |
| `commands/registry.js` | فرمان‌ها: برجسته (`<mark>`)، بالانویس/زیرنویس، نقل برجسته، ریز، امضای ته متن، یادداشت ویراستار، **فاصله‌ی صحنه**، جعبه‌ی هشدار (فرم انتخاب نوع)، بخش تاشو. ۸ آیکون تازه. **دکمه‌ی بریده اصلاح شد**: قبلاً فقط `EXCERPT-END` می‌گذاشت؛ حالا جفت کامل با متن نمونه |
| `main.js` | `ctx.insertAdmonition` و `ctx.insertDetails` |
| `ui/toolbar-config.js` | پیش‌فرض نوار: mark، pullquote، scene-break، admonition، details، excerpt |
| `model/paragraph-ids.js` | ردِ خط‌های `///`، واژه‌نامه (`: `) و کوته‌نوشت (`*[`). نثرِ **داخل** جعبه شناسه می‌گیرد — هایلایت داخل `/// warning` کار می‌کند |
| `model/stats.js` | نحو تازه از شمارش نثر کنار گذاشته شد |

## سه — نقل‌قول‌های خمیده

`Ctrl+Alt+1` تا `4` → `‘` `’` `“` `”` — **ردیف بالای صفحه یا ناپد، هر دو** (با e.code؛ مستقل از چیدمان فارسی). پرشِ شماره‌ای به سند (`Ctrl+Alt+۱تا۹`) حذف شد — چهار کلیدش را این‌ها گرفتند؛ چرخش سندها با `Ctrl+Alt+←/→` باقی است. نگهبان‌ها: NumLock خاموش روی ناپد = End/Home سالم؛ فوکوس روی فیلد دیگری باشد (پانویس، جست‌وجو) درج به آنجا سرریز نمی‌شود. چهار فرمان در منوی درج + نوار + کارت F1.

## چهار — اصلاح باگ‌ها

| باگ | ریشه | اصلاح |
|---|---|---|
| ویرایش پانویس/سرچشمه پرش به اول متن | `setText` مکان‌نما را صفر می‌کرد | `panelHandlers.setBody` مکان‌نما را نگه می‌دارد (main.js) |
| پانویس لاتین راست‌چین اذیت می‌کرد | جهت ثابت RTL | تشخیص خودکار با `textDirection` — یک حرف فارسی = RTL؛ تمام‌لاتین = چپ‌چین با قلم لاتین (ui/footnotes.js + tabs.css) |
| «منابع» غلط شمرده می‌شد | lint/repair قدیمی | قانون حذف شد — build.py هر پنج عنوان را قبول می‌کند (تأیید از SOURCES_HEADINGS) |
| «کتابنامه» در پانل دیده نمی‌شد | رجکس ناقص | هر پنج عنوان (model/sources.js) |
| دکمه‌ی بریده ناقص | فقط END | جفت کامل (بالا) |
| `category: novelette` خطا می‌گرفت | درفت دسته‌ها | بالا |

## پنج — پایتون: دست‌نخورده؛ یک پچ لازم، منتظر اجازه‌ی تو

**شکاف `freeze_ids.py`:** الگوی `///` و واژه‌نامه در `IGNORE_PATTERNS` نیست. استودیو (درست) از این بلوک‌ها می‌پرد، ولی پایتون به آن‌ها `{: #p-x }` می‌چسباند و فایل را می‌نویسد — خط شناسه بیرونِ جعبه/واژه‌نامه می‌افتد و **عیناً روی سایت چاپ می‌شود**. اولین build بعد از اولین استفاده‌ی تو از `///`، فایل‌ها را خراب می‌کند.

پچ (در `Desktop\asbpub\freeze_ids.py`):

۱) در `IGNORE_PATTERNS` (خط ۱۰ تا ۲۰)، بعد از آخرین عضو این خط را اضافه کن — ۴ فاصله تورفتگی، مثل بقیه:

```python
    r'///',                      # admonition / details fence
```

۲) بلوک `if should_ignore(block):` (خط ۹۴ تا ۹۶، تورفتگی ۱۲ فاصله) را پیدا کن و **بعد از** `continue` آن، این را اضافه کن — دو `if` در همان ۱۲ فاصله، بدنه‌ها ۱۶ فاصله:

```python
            # Callout fences and definition lists are structure, not prose.
            # An id line appended after them lands outside the block and
            # prints literally on the site - the block is left alone.
            block_lines = block.splitlines()
            if any(re.match(r'^\s{0,3}///\s*$', l) for l in block_lines):
                new_blocks.append(block)
                continue
            if any(re.match(r'^\s{0,3}:\s', l) for l in block_lines):
                new_blocks.append(block)
                continue
```

بعدش: `python -m py_compile freeze_ids.py` و یک `python build.py` آزمایشی.

**کتابنامه و سرچشمه — چه‌طور است و چه‌طور باید باشد:** عنوان (`## کتابنامه`) با الگوی heading رد می‌شود ✓؛ مدخل لیستی (`-` یا `1.`) با الگوی لیست رد می‌شود ✓؛ مدخل **پاراگرافی ساده** شناسه می‌گیرد — در هر دو طرف (JS و Python) یکسان، بی‌ضرر (build.py فقط در بریده شناسه‌ها را خالی می‌کند)، پس هیچ تغییری لازم نیست. هماهنگی دو طرف همان معیار است.

## شش — ردیاب تغییرات: بررسی شد، اصلاح شد ✅

با پروب واقعی (fuzz چندصد سید + شبیه‌سازی دقیق کلیکِ پانل) سه ریشه پیدا و هر سه بسته شد:

1. **خرابیِ «رد کن»/«بپذیر» (دلیل «کم و زیاد قاتی»):** دو باگ روی‌هم — (الف) برشِ رشته‌ی خام با آفستِ نرمال‌شده، (ب) ردِ نیمِ یک جایگزینی (جفت حذف+افزودن چسبیده) که توکن‌ها را به‌هم می‌چسباند و ردیاب دور خودش می‌چرخید. **درمان:** `resolveChange` دیگر نمی‌بُرد — از روی فهرستِ واحد (same + تغییرها) بازسازی می‌کند؛ جفت‌های چسبیده در `changeList` یک «جایگزینی» واحدند (مثل ورد؛ پانل هم حالا «جایگزینی» با قدیم ← جدید نشان می‌دهد). نتیجه‌ی آزمون: ردِ همه تغییرها **عیناً** متن اول را برمی‌گرداند، پذیرش همه عیناً متن تازه را می‌سازد — ۳۰۰ سید، بدون یک استثنا.
2. **CRLF:** مبنا حالا هنگام ذخیره نرمال (`\n`) می‌شود (track.js) — سندِ ویندوزیِ فضای مشترک دیگر همه‌ی آفست‌ها را نمی‌لغزاند.
3. **«خودش روشن می‌شود»:** (الف) فایل محلی دیگر مبنا در localStorage ندارد — کلیدش فقط «نام» بود و نصف آرشیو `index.md` است؛ ردیابی محلی حالا فقط تا بستن مرورگر (track.js دو حافظه شد). (ب) خاموش کردن ردیاب، ستون `baseline` را از فضای مشترک هم پاک می‌کند (`clearBaseline`) تا سند فردا با ردیابِ دیروز باز نشود. (ج) باز کردن با baseline خالی، ردیاب را روشن نمی‌کند.

+ استحکام‌ها: کلیک ردیف، تغییر را با **هویتش** (نوع/جا/اندازه) در دیف تازه می‌یابد نه ایندکس قدیمی؛ شکست سهمیه‌ی localStorage دیگر بی‌صدا نیست (هشدار می‌دهد)؛ پذیرش/ردِ همه و توقف همانند قبل.

## شش‌الف — این دور (بازخورد تو)

- **بریده‌ی نمایشی:** حالا دور **انتخاب خودت** قاب می‌گذارد — هر چند بند که خواستی؛ استارت بالای انتخاب، اِند پایینش؛ بدون متن نمونه. بدون انتخاب: هشدار.
- **دسته‌های article** (تک‌مقاله/مجموعه‌مقاله) از استودیو و `data/categories.json` حذف شد — در build.py هم نیست.
- **کلیدهای نقل‌قول** به ردیف بالای صفحه هم وصل شد و پرش شماره‌ای سند حذف شد (بخش سه).
- **فهرست کشویی فضای مشترک:** گفت‌وگوی «ذخیره در فضای مشترک» حالا به‌جای تایپ پوشه، **بخش** را با منوی بازشو انتخاب می‌کند — گزینه‌ها همان دسته‌های سایت‌اند (`data/categories.json`)، دسته‌ی خودِ سند از قبل انتخاب است، مقدار قدیمیِ بیرون از فهرست با برچسب «(قدیمی)» نشان داده می‌شود، نه اینکه بی‌صدا جایی دیگر برود (ui/workspace.js).
- **کلاس‌های جعبه‌ها = کلاس‌های پایتون:** پیش‌نمایش/ایپاب/گزارش حالا `admonition note`، `admonition details`... تولید می‌کنند — همان خروجی pymdownx — تا DOM استودیو و سایت جابه‌جاپذیر باشد و رنگ‌های سایت (پیوست پایین) با همان قلاب‌ها بنشیند.

## هفت — وضعیت و تست

- تست خودکار: **۳۸/۳۸ سبز** (round-trip بایت‌به‌بایت با گیومه/CRLF/BOM، normalize، sources پنج‌عنوانی، lint، site-blocks، شناسه‌ها، validate، پیش‌نمایش).
- پروب ردیاب: **۳۰۰/۳۰۰ سبز** — ردِ همه = عین متن اول؛ پذیرشِ همه = عین متن تازه؛ CRLF امن؛ بدترین مورد ۹ کلیک.
- سینتکس تک‌تک فایل‌های تغییرکرده: سبز. `categories.json` معتبر.
- QA دستی پیشنهادی: `python serve.py` → پانل تغییرات را با یک ویرایش واقعی امتحان کن (چند واژه را عوض کن، یکی‌یکی بپذیر/رد، بعد «رد همه»)؛ بریده را با انتخاب ۳ بند بساز؛ `Ctrl+Alt+1..4` را روی ردیف بالا بزن؛ پانویس لاتین؛ ذخیره با فرانت‌متر.

## هشت — محدودیت‌های شناخته‌شده

- رنگ‌آمیزی کد (codehilite/pygments) در پیش‌نمایش نیست — بلوک ساده نشان داده می‌شود؛ رنگش فقط روی سایت می‌آید.
- کوته‌نوشت داخل کد درون‌خطی اعمال نمی‌شود (عمدی).
- پانویسِ تعریف‌شده داخل بلوک `///` در پیش‌نمایش شماره کلیک‌پذیر نمی‌شود (رندر تو در تو)؛ روی سایت سالم است.
- `original_cover` که build.py می‌خواند عمداً «ناشناخته» مانده تا در فهرست حفظ‌شده‌ها دیده شود.
- رنگ‌های پیش‌نمایشِ تغییرها (All Markup) ممکن است وسط نحوِ مارک‌دان یک‌جا جابه‌جا دیده شوند — نمایش است، متن سند دست نمی‌خورد.

## نه — کارهای باز

1. پچ freeze_ids.py — با اجازه‌ی تو (متن در بخش پنج).
2. (اختیاری) هم‌تراز کردن رنگ‌های admonition با CSS واقعی سایت، وقتی فایل css سایت را بدهی.

---

## پیوست — CSS آماده‌ی جعبه‌ها برای سایت (خودت اعمال کن)

**یافته:** uild.py افزونه‌های admonition/details را روشن دارد و خروجی‌شان این کلاس‌هاست —
<div class="admonition note"> با <p class="admonition-title"> و <details class="admonition details"> با <summary> —
اما در هر ۲۶ فایل css/src، در style.css تولیدی، در قالب‌ها و JS حتی یک اشاره به dmonition نیست.
یعنی جعبه‌ها روی سایت بدون استایل‌اند. (تنها .note/.tipهای پیدا شده mark.user-note.*اند — هایلایت خواننده، بی‌ربط.)

**جا:** فایل تازه‌ی css/src/36-admonitions.css — بیلد فایل‌های css/src را به‌ترتیب نام می‌چسباند، پس «۳۶» بعد از «35-profile» می‌نشیند.
بعدش: python build.py → یک صفحه با /// در پوسته‌ی روشن و شب → کامیت و پوش.

``css
/* ==========================================================================
   Admonitions — the /// boxes (pymdownx.blocks.admonition + .details)

   build.py has shipped with these two extensions enabled, but their output
   went to the page undressed: nothing in css/src styled .admonition, so a
   warning box read as an ordinary paragraph and a spoiler as the browser's
   bare <details>.

   The hooks here are the exact classes pymdownx emits — the type travels as
   the second class (dmonition note, dmonition tip, …) and the title
   rides in its own .admonition-title paragraph. When the markdown changes
   type, only the accent moves.

   Tones, per RAHNAMANEVESHTAN.md بخش نه:
     note · important · hint   → ochre   (a remark, not an alarm)
     tip                       → blue    (a hand offered to the reader)
     warning · attention · caution · danger · error → red
   ========================================================================== */

.admonition {
  margin: 2em 0;
  padding: 16px 20px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  /* The accent edge is the type's colour; the border stays quiet, so nine
     words read as three colours without nine different boxes. */
  border-inline-start: 3px solid var(--accent-ochre);
  border-radius: var(--radius-md);
}

/* A box is a voice commenting on the text — the prose inside it keeps the
   article's rhythm but drops the paragraph indent, the way a blockquote
   already does. */
.admonition p {
  text-indent: 0;
}

.admonition-title {
  font-weight: 700;
  font-size: 0.9em;
  color: var(--accent-ochre-hover);
  margin: 0 0 0.6em;
}

/* --- the three tones ------------------------------------------------------ */

.admonition.note,
.admonition.important,
.admonition.hint {
  background: rgba(212, 154, 0, 0.06);
}

.admonition.tip {
  border-inline-start-color: var(--clr-blue);
  background: rgba(52, 170, 225, 0.06);
}

.admonition.tip .admonition-title {
  color: var(--clr-blue);
}

.admonition.warning,
.admonition.attention,
.admonition.caution,
.admonition.danger,
.admonition.error {
  border-inline-start-color: var(--clr-red);
  background: rgba(217, 72, 72, 0.06);
}

.admonition.warning .admonition-title,
.admonition.attention .admonition-title,
.admonition.caution .admonition-title,
.admonition.danger .admonition-title,
.admonition.error .admonition-title {
  color: var(--clr-red);
}

/* ==========================================================================
   The collapsible — /// details | عنوان
   A spoiler hides inside the same box; the summary row carries the accent
   wash so the folded state already says "something is in here".
   ========================================================================== */

details.admonition {
  padding: 0;
  overflow: hidden;
}

details.admonition summary {
  cursor: pointer;
  padding: 12px 20px;
  font-weight: 700;
  color: var(--accent-ochre-hover);
  background: rgba(212, 154, 0, 0.06);
  list-style: none;
}

/* The browser's triangle points the wrong way for an RTL page; a caret of
   our own flips with the open state instead. */
details.admonition summary::-webkit-details-marker {
  display: none;
}

details.admonition summary::after {
  content: ' ▾';
  opacity: 0.6;
}

details.admonition[open] summary::after {
  content: ' ▴';
}

details.admonition[open] summary {
  border-bottom: 1px solid var(--border-color);
}

details.admonition > *:not(summary) {
  margin-inline: 20px;
}

details.admonition > :last-child {
  margin-bottom: 16px;
}

/* ==========================================================================
   Dark theme — same hues, dimmer ground
   The tints drop to a lower alpha over near-black, and the title colours
   lift to the brighter variants the badges already use at night.
   ========================================================================== */

[data-theme="dark"] .admonition {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--border-dark);
}

[data-theme="dark"] .admonition.note,
[data-theme="dark"] .admonition.important,
[data-theme="dark"] .admonition.hint {
  background: rgba(212, 154, 0, 0.08);
}

[data-theme="dark"] .admonition.tip {
  background: rgba(52, 170, 225, 0.08);
}

[data-theme="dark"] .admonition.warning,
[data-theme="dark"] .admonition.attention,
[data-theme="dark"] .admonition.caution,
[data-theme="dark"] .admonition.danger,
[data-theme="dark"] .admonition.error {
  background: rgba(217, 72, 72, 0.08);
}

[data-theme="dark"] .admonition-title {
  color: var(--accent-ochre);
}

[data-theme="dark"] .admonition.tip .admonition-title {
  color: var(--badge-login);
}

[data-theme="dark"] .admonition.warning .admonition-title,
[data-theme="dark"] .admonition.attention .admonition-title,
[data-theme="dark"] .admonition.caution .admonition-title,
[data-theme="dark"] .admonition.danger .admonition-title,
[data-theme="dark"] .admonition.error .admonition-title {
  color: #E57373;
}

[data-theme="dark"] details.admonition summary {
  color: var(--accent-ochre);
}
``

استودیو هم‌کلاس شده: پیش‌نمایش/ایپاب/گزارش همان dmonition {type} را تولید می‌کنند (بخش شش‌الف)،
پس این CSS بدون هیچ تغییری برای هر دو محیط یکی است.
