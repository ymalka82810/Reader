import { describe, expect, it } from 'vitest'
import { parseHeWiktionaryPage, plainText, readDumpPages } from './heWiktionary'

const PAGE = `{{חסר|כָּלַב}}
==גָּדוֹל==
{{ניתוח דקדוקי
|כתיב מלא=גדול
|חלק דיבר=שם־תואר
|נטיות=נ' גְּדוֹלָה, ר' גְּדוֹלִים
}}
# בעל [[מדה|מידה]] מרובה, תופס [[מרחב]] רב.<ref>מקור</ref>
#:* דוגמה שאינה הגדרה
#{{משלב|סלנג}} טוב, '''מוצלח'''.
===מילים נרדפות===
* [[כביר]] (1)
* [[רב#רַב א|רַב]]
* [[w:משהו|לא מילה]]
===ניגודים===
*[[קטן]]
===תרגום===
* [[small]]
==הָלַךְ==
{{ניתוח דקדוקי לפועל|
|כתיב מלא=הלך
|בניין=קל
|נטיות=}}
#{{מקרא}} צעד ממקום למקום.
`

describe('parseHeWiktionaryPage', () => {
  const [big, walk] = parseHeWiktionaryPage(PAGE)

  it('reads each entry of the page with its part of speech and definitions, not its examples', () => {
    expect(big!.word).toBe('גָּדוֹל')
    expect(big!.pos).toBe('שם תואר')
    expect(big!.senses).toEqual([{ glosses: ['בעל מידה מרובה, תופס מרחב רב.'] }, { glosses: ['(סלנג) טוב, מוצלח.'] }])
    expect(walk!.pos).toBe('פועל, בניין קל')
    expect(walk!.senses).toEqual([{ glosses: ['(מקרא) צעד ממקום למקום.'] }])
  })

  it('takes the full spelling and the pointed inflections as forms', () => {
    expect(big!.forms).toEqual([{ form: 'גדול' }, { form: 'גְּדוֹלָה' }, { form: 'גְּדוֹלִים' }])
  })

  it('takes synonyms and antonyms from their sections, as shown, and not from other sections', () => {
    expect(big!.synonyms).toEqual([{ word: 'כביר' }, { word: 'רַב' }])
    expect(big!.antonyms).toEqual([{ word: 'קטן' }])
    expect(walk!.synonyms).toBeUndefined()
  })
})

describe('plainText', () => {
  it('drops markup, references, comments and unknown templates', () => {
    expect(plainText("א [[ב|ג]] <small>ד</small> {{צט/תנ\"ך|פסוק|שמות}}<!-- הערה -->ה ''ו''")).toBe('א ג ד ה ו')
  })
})

describe('readDumpPages', () => {
  it('yields the wikitext of main-namespace pages only, unescaped', async () => {
    const xml = [
      '<page>', '<title>מדיה ויקי:x</title>', '<ns>8</ns>', '<text bytes="1">skip</text>', '</page>',
      '<page>', '<title>כלב</title>', '<ns>0</ns>', '<text bytes="9" xml:space="preserve">==כֶּלֶב==', '# &lt;b&gt; &amp; &quot;</text>', '</page>',
      '<page>', '<title>ריק</title>', '<ns>0</ns>', '<text bytes="0" />', '</page>',
    ]
    async function* lines() {
      yield* xml
    }
    const pages: [string, string][] = []
    await readDumpPages(lines(), (title, text) => pages.push([title, text]))
    expect(pages).toEqual([['כלב', '==כֶּלֶב==\n# <b> & "']])
  })
})
