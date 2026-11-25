/* ============================================================
 * config.js —— 唯一需要改动的文件
 * 说明：所有文字、图片、尺寸都在这里。版式与配色由代码处理。
 * 注意：内容冻结原则 —— 这里的文字将与原件逐字一致，不要在此增删。
 * ============================================================ */

window.POSTER_CONFIG = {
  meta: {
    kicker: 'PART I',
    title: 'Fundamentals: Foundational Theoretical Basis and Central Themes',
    subtitle: 'A Structured Review of Key Frameworks and Their Analytical Implications',
    authors: 'Author Name · Student ID · Course Code',
    affiliation: 'Department of Social Sciences · University Name',
    footer: 'Academic Poster · Part I · 2026',
  },

  /* 原文件配色（默认锁定，导出时零改动） */
  originalColors: {
    main: '#1B3A5C',
    accent: '#B08A3E',
    bg: '#FFFFFF',
    locked: true,
  },

  /* 预置主题（只有主色，其余自动派生） */
  presets: [
    { id: 'academic-blue', name: '学术蓝', main: '#1B3A5C' },
    { id: 'ink-green',     name: '墨绿',   main: '#1F4D3A' },
    { id: 'wine',          name: '酒红',   main: '#6B1F2A' },
    { id: 'graphite',      name: '石墨',   main: '#2B2B2B' },
    { id: 'haze-purple',   name: '雾霾紫', main: '#4A3B5C' },
    { id: 'warm-ochre',    name: '暖赭',   main: '#7A4B2A' },
  ],

  /* 三种输出格式的规格（按要求：照原件）
   * ppt : 英寸，16:9 → 13.333 × 7.5
   * pdf : 英寸，A4 竖版 → 8.268 × 11.693
   * word: 英寸，A4 竖版
   * 原件到手后只改这里
   */
  formats: {
    ppt:  { width: 13.333, height: 7.5,    cols: 3, preview: { w: 1280, h: 720 } },
    pdf:  { width: 8.268,  height: 11.693, cols: 2, preview: { w: 794,  h: 1123 } },
    word: { width: 8.268,  height: 11.693, cols: 1, preview: { w: 794,  h: 1123 } },
  },

  /* 正文区块：顺序 = 原件顺序，不得调整；body 一字不改 */
  sections: [
    {
      no: '01',
      title: 'Background',
      body: [
        'Placeholder paragraph 1 — the original text of this section will be pasted here verbatim, with no edits to wording, punctuation, or spelling.',
        'Placeholder paragraph 2 — line breaks follow the source document so that paragraph structure is preserved exactly.',
      ],
      figure: null,
    },
    {
      no: '02',
      title: 'Statement of the Problem',
      body: [
        'Placeholder paragraph — this section states the research problem in the original wording. Only the column width and line length change during typesetting.',
      ],
      figure: null,
    },
    {
      no: '03',
      title: 'Theoretical Framework',
      body: [
        'Placeholder paragraph — the original framework description goes here unchanged.',
      ],
      figure: { src: '', caption: 'Figure 1. Original figure will be embedded here without cropping or replacement.' },
    },
    {
      no: '04',
      title: 'Method',
      body: [
        'Placeholder paragraph — the original method section text, preserved word for word.',
      ],
      figure: null,
    },
    {
      no: '05',
      title: 'Key Findings',
      body: [
        'Placeholder paragraph — original findings, including any numbers, are kept exactly as written.',
      ],
      figure: { src: '', caption: 'Figure 2. Original figure placement, same order as the source document.' },
    },
    {
      no: '06',
      title: 'Implications & Conclusion',
      body: [
        'Placeholder paragraph — the original concluding remarks, unchanged in content and length.',
      ],
      figure: null,
    },
    {
      no: '07',
      title: 'References',
      body: [
        'Placeholder references — citation style and order follow the original document exactly.',
      ],
      figure: null,
    },
  ],
};
