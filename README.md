# קורא ספרים

[![CI](https://github.com/ymalka82810/Reader/actions/workflows/ci.yml/badge.svg)](https://github.com/ymalka82810/Reader/actions/workflows/ci.yml)

קורא EPUB ו-PDF בעברית (PWA). הטקסט מתארגן מחדש לפי גודל הגופן והמסך, מספר העמודים מחושב מחדש בכל שינוי, והמיקום נשמר כך שלא הולכים לאיבוד כשמשנים גודל.

## מבנה התיקיות
| תיקייה | תוכן |
|---|---|
| `src/components/` | מסכי הספרייה והקורא; `library/` ו-`reader/` מכילות את החלקים שלהם |
| `src/hooks/` | הלוגיקה של המסכים (ייבוא, גיבוי, מעקב קריאה, קריאה אוטומטית, בדיקת עדכון) |
| `src/lib/` | לוגיקה בלי React: מסד נתונים, גיבוי והצפנה, המרת PDF/TXT ל-EPUB, OCR, הגדרות, ‏`updater.ts` |
| `public/` | אייקונים של ה-PWA וסקריפט ה-share-target |
| `resources/` | קבצים לאנדרואיד שנוספים לפרויקט בזמן הבנייה: אייקוני אפליקציה ו-`android-updater/` |
| `e2e/` | בדיקות Playwright |
| `.github/workflows/` | CI, פריסה ובניית APK |

## יכולות
- פתיחת קבצים מהטלפון או מגוגל דרייב דרך בורר הקבצים של המכשיר (`<input type=file>`).
- ספרייה מקומית ב-IndexedDB: כריכה, כותרת, אחוז התקדמות, מחיקה.
- מצב גלילה רציפה או מצב עמודים, שלוש ערכות צבע, גודל גופן, ריווח שורות, גופן, יישור.
- ספירת עמודים מחדש: ״עמוד X מתוך Y״ מוערך לפי גודל התוכן וגודל העמוד בפועל.
- שמירת מיקום אוטומטית (CFI).
- EPUB מוצג בעזרת [foliate-js](https://github.com/johnfactotum/foliate-js).
- PDF: בזמן ההוספה הטקסט מחולץ עם pdf.js, מחולק לפסקאות וממיר לקובץ EPUB אמיתי (EPUB 3, עם תוכן עניינים וכיווניות RTL). רק הוא נשמר ונקרא, בדיוק כמו כל EPUB. זיהוי אוטומטי של טקסט הפוך (סדר ויזואלי).
- יבוא קבצי TXT: הטקסט מומר ל-EPUB (פסקאות, כותרת משם הקובץ), בדיוק כמו PDF.
- יבוא מהשיתוף: כשהאפליקציה מותקנת כ-PWA היא מופיעה בתפריט ״שתף״ של המכשיר (share-target), וקובצי EPUB, PDF ו-TXT שמשתפים אליה נוספים לספרייה.
- הערות והדגשות: בחירת טקסט מאפשרת להדגיש בצבע ולהוסיף הערה, ואפשר להוסיף סימניות. הכול נשמר לכל ספר ומופיע ברשימה אחת.
- סטטיסטיקת קריאה: זמן קריאה לכל ספר, נשמר מקומית.
- גיבוי וייצוא של הספרייה לקובץ אחד, עם הצפנה אופציונלית (ראו ״גיבוי״ למטה).
- מעבר עמודים בלחיצה על צדי המסך: צד ימין מעביר ימינה, צד שמאל מעביר שמאלה (30% מכל צד), והאמצע מציג/מסתיר את התפריטים. עובד גם במצב גלילה.

## הרצה
```bash
npm install
npm run dev        # פיתוח
npm run build      # בדיקת טיפוסים + בנייה ל-dist/
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm run knip       # קוד, ייצואים ותלויות שאינם בשימוש
npm test           # vitest
```

TypeScript רץ במצב `strict` מלא, בתוספת `noUncheckedIndexedAccess`, `noImplicitReturns` ו-`noImplicitOverride`.

## מגבלות ידועות
- PDF סרוק (תמונות בלי שכבת טקסט) עובר זיהוי טקסט (OCR) אוטומטי עם Tesseract.js (עברית ואנגלית). המודלים יורדים מהרשת בפעם הראשונה בלבד (כמה מגה-בייט), והתהליך איטי: בערך כמה שניות לעמוד. נדרש חיבור לאינטרנט בפעם הראשונה.
- PDF עם עמודות, הערות שוליים או טבלאות יחולץ בסדר לא מושלם. מתאים לספרי קריאה פשוטים.
- ספירת העמודים היא הערכה, בעיקר בספרים עם הרבה תמונות.
- ההתקנה כ-PWA דורשת HTTPS (למשל GitHub Pages).

## פריסה
- **CI** ([ci.yml](.github/workflows/ci.yml)): על כל pull request ועל כל push ל-`main` רצים `lint`, `npm run build` (‏`tsc -b` + בניית Vite/PWA, כך ששבירת בנייה נתפסת לפני המיזוג), `knip` ו-`test`.
- **פריסה** ([deploy.yml](.github/workflows/deploy.yml)): כל push ל-`main` בונה (`npm run build`) ומפרסם את `dist/` ל-GitHub Pages.
  להפעלה חד-פעמית: Settings ← Pages ← Source: **GitHub Actions**.
- האתר משתמש ב-`base: './'`, ולכן עובד מכל תת-נתיב (`https://<user>.github.io/<repo>/`) בלי הגדרה נוספת. התקנה כ-PWA דורשת HTTPS, ו-Pages מספק אותו.
- ה-service worker מתעדכן אוטומטית (`registerType: 'autoUpdate'`), אז גרסה חדשה נטענת בביקור הבא אחרי הפריסה.

## זרימת עבודה
`main` מוגן: אי אפשר לדחוף אליו ישירות, וכל מיזוג אליו מתפרסם מיד למשתמשים (ראו ״פריסה״).
1. פותחים ענף: `git switch -c my-change`, עושים commit ודוחפים: `git push -u origin my-change`.
2. פותחים PR: `gh pr create --fill`.
3. ממתינים שבדיקת ה-CI (`check`) תהיה ירוקה. בלעדיה אי אפשר למזג.
4. ממזגים: `gh pr merge --squash --delete-branch`. המיזוג מפעיל את הפריסה.

ההגנה חלה גם על בעל הריפו. לעקיפה בחירום: Settings ← Branches, או `gh api -X DELETE repos/ymalka82810/Reader/branches/main/protection`.

## אפליקציית אנדרואיד
אותה אפליקציית ווב נארזת ל-APK בעזרת [Capacitor](https://capacitorjs.com/) 7. תיקיית `android/` **לא נמצאת ב-git**: היא נוצרת מחדש בכל בנייה, ו-Capacitor מותקן רק בתוך ה-workflow (`--no-save`), כך ש-`package.json` ו-lockfile לא משתנים.

### בנייה
ב-GitHub: Actions ← **Build Android APK** ← Run workflow ([android.yml](.github/workflows/android.yml)). השלבים:
1. [build.yml](.github/workflows/build.yml) בונה את `dist/` פעם אחת, וגם הפריסה ל-Pages וגם ה-APK משתמשים בו.
2. `cap init` (מזהה החבילה `com.yanivm.reader`, ‏`webDir` = `dist`) ו-`cap add android`.
3. מעתיקים את אייקוני ההפעלה מ-[resources/android/](resources/android/), כי `android/` נוצר מאפס.
4. מוסיפים את מנגנון העדכון (ראו למטה): ה-plugin, ההרשאה, נתיב ה-FileProvider ומספרי הגרסה.
5. חותמים במפתח קבוע (ראו ״חתימה״) ומריצים `cap sync` ו-`./gradlew assembleDebug`.
6. ה-APK מועלה כ-artifact בשם `reader-debug-apk` וגם מתפרסם כ-GitHub Release.

בנייה מקומית אפשרית באותו אופן (צריך JDK 21 ו-Android SDK): מתקינים את חבילות Capacitor, מריצים `cap init`, ‏`cap add android` ו-`cap sync`, ובונים עם Gradle. ההתאמות בשלב 4 נעשות ב-`sed` ב-android.yml, ואותן יש לשחזר ידנית.

### חתימה
כל גרסה חייבת להיות חתומה **באותו מפתח** כדי שאנדרואיד יסכים להתקין אותה מעל הקודמת. המפתח (PKCS12, ‏alias ‏`reader`) נשמר כ-secrets של הריפו:
- `KEYSTORE_BASE64`: קובץ ה-keystore בקידוד base64.
- `KEYSTORE_PASSWORD`: הסיסמה שלו, גם לחנות וגם למפתח.

ה-workflow מחבר אותו ל-`signingConfigs.debug`, ולכן גם ה-APK ה״debug״ חתום במפתח הקבוע. **אין דרך לשחזר מפתח שאבד**: משתמשים יצטרכו להסיר ולהתקין מחדש (והספרייה המקומית תימחק, אז כדאי לגבות).

### עדכון עצמי
האפליקציה מתעדכנת בלי חנות, מתוך ה-Releases של הריפו:
1. **גרסה:** `versionCode` הוא מספר ההרצה של ה-workflow, ו-`versionName` הוא `1.0.<n>`. כל הרצה מפרסמת Release עם תג `v1.0.<n>`, את ה-APK, והערות בפורמט:
   ```
   versionCode: <n>
   sha256: <hash של ה-APK>
   ```
2. **בדיקה:** בתפריט ⋯ ← ״בדוק עדכון״ (מופיע רק באפליקציה, לא ב-PWA). [updater.ts](src/lib/updater.ts) קורא את ה-Releases דרך ה-API של GitHub, מחפש את החדש ביותר שהתג שלו מתחיל ב-`v` וספרה, ומשווה את ה-`versionCode` שלו לזה של האפליקציה המותקנת. ה-API האנונימי מוגבל ל-60 קריאות בשעה, ולכן התשובה נשמרת עם ETag (תשובת 304 לא נספרת) ומשמשת גם כשהמכסה נגמרה.
3. **התקנה:** אחרי אישור, [useUpdateCheck.ts](src/hooks/useUpdateCheck.ts) קורא ל-plugin הנייטיב [AppUpdaterPlugin.java](resources/android-updater/AppUpdaterPlugin.java). הוא מוריד את ה-APK דרך `DownloadManager` (ההורדה נמשכת גם כשיוצאים מהאפליקציה), מוודא sha256 ושזו אותה חבילה בגרסה חדשה יותר, ופותח את חלון ההתקנה של המערכת. בהתקנה הראשונה אנדרואיד מבקש פעם אחת ״אפשר התקנה מהאפליקציה הזו״.
4. **שגיאות:** ה-plugin דוחה עם `busy`, ‏`bad url`, ‏`download`, ‏`checksum`, ‏`not an update`, ‏`permission` או `no installer`, וההודעה מוצגת למשתמש.

ה-plugin מדבר עם ה-JS דרך גשר Capacitor שמוזרק לדף, ולכן `@capacitor/core` לא נכלל ב-bundle של הווב.

## גיבוי
בתפריט ⋯ ← ״גיבוי״ נוצר קובץ `.readerbackup` אחד עם הספרים, הכריכות, מיקום הקריאה, ההערות, הסטטיסטיקה וההגדרות. ״שחזור״ ממזג אותו עם מה שכבר במכשיר: מיקום עדכני יותר גובר, הערות ממוזגות לפי מזהה, ואף פעם לא נמחק דבר.

**הצפנה (אופציונלית):** אם מזינים סיסמה בעת הגיבוי, כל הקובץ מוצפן ב-AES-256-GCM עם מפתח שנגזר ב-PBKDF2-SHA256 (600,000 סבבים, מלח אקראי לכל קובץ). ההצפנה נעשית בקטעים של 1MB כדי שספרייה גדולה לא תיטען כולה לזיכרון, וכל קטע מאומת, כך שקובץ שנחתך או שונה נדחה. שחזור של גיבוי מוצפן מבקש את הסיסמה. **אין דרך לשחזר סיסמה שאבדה.** פירוט הפורמט בראש [encrypt.ts](src/lib/encrypt.ts).

## מבנה הנתונים
כל המידע נשמר בדפדפן. אין שרת. הגישה דרך [idb-keyval](https://github.com/jakearchibald/idb-keyval), שמפעיל כל אחד ממאגרי ה-IndexedDB הבאים כמאגר key-value (המפתח הוא מזהה הספר, ה-SHA-256 של הקובץ המקורי):

| מסד IndexedDB | Store | ערך | הערה |
|---|---|---|---|
| `reader-db` | `books` | `BookRecord` | הקובץ (Blob), כריכה, כותרת, מחבר, `finished` |
| `reader-progress-db` | `progress` | `Progress` (`cfi`, `fraction`, `lastOpened`) | נפרד כדי ששמירת מיקום לא תכתוב מחדש את ה-Blob של הספר |
| `reader-notes-db` | `notes` | `Annotation[]` | הדגשות וסימניות לכל ספר |

ב-`localStorage`: הגדרות תצוגה (`settings.ts`), סטטיסטיקת קריאה לכל ספר (`stats.ts`), מועד הגיבוי האחרון (`reader:lastBackup`) וגרסת הסכימה (`reader:schemaVersion`). בסשן: הספר הפתוח (`reader:open`).

הטיפוסים נמצאים ב-[db.ts](src/lib/db.ts). פורמט קובץ הגיבוי (`Manifest`, ‏`version: 1`) מתועד ב-[backupManifest.ts](src/lib/backupManifest.ts).

### גרסאות ו-migrations
idb-keyval פותח כל מסד בגרסה 1 ולא משדרג אותו, כך שהמאגרים עצמם קבועים. מה שמשתנה הוא צורת הרשומות. לכן [db.ts](src/lib/db.ts) מחזיק מערך `migrations` מסודר, וגרסת הסכימה היא אורכו. `migrate()` רץ פעם אחת עם עליית האפליקציה (`main.tsx`), לפני שמשהו קורא את הספרייה, ומריץ רק את הצעדים שעוד לא רצו.

להוספת שינוי בצורת הנתונים:
1. מוסיפים צעד **בסוף** המערך. לא עורכים ולא מסדרים מחדש צעד שכבר שוחרר.
2. הצעד חייב להיות אידמפוטנטי, כי הגרסה השמורה עלולה ללכת לאיבוד (גלישה פרטית, ניקוי נתוני אתר) וכל הצעדים ירוצו שוב.
3. מוסיפים בדיקה ב-[migrations.test.ts](src/lib/migrations.test.ts).
4. אם משתנה גם הפורמט של קובץ הגיבוי, מעלים את `Manifest.version` ומוסיפים תמיכה לאחור ב-`importLibrary`. גיבויים ישנים חייבים להמשיך להיפתח.

## שגיאות
- כשייבוא קובץ נכשל (סוג לא נתמך, קובץ ריק או פגום, PDF סרוק או מוגן בסיסמה, אין מקום באחסון) מוצגת הודעה ברורה בעברית ליד שם הקובץ. הפרטים הטכניים נכתבים ל-console. ההודעות מוגדרות ב-[errors.ts](src/lib/errors.ts).
- קריסת רינדור בקורא נתפסת ב-Error Boundary ([ErrorBoundary.tsx](src/components/ErrorBoundary.tsx)) ומציגה כפתור חזרה לספרייה, במקום מסך ריק.
