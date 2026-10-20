// All page copy (Mongolian) and the scroll milestones it is tied to.

import type { LayerName } from './anatomy-scene';

export const brand = 'Хүний бие 3D';

// the four layers: header "models" menu (menuLabel) and the side progress labels (label)
export const navItems = [
    { href: '#slide-1', label: 'Арьс', menuLabel: 'Арьс', scroll: 0.0 },
    { href: '#slide-2', label: 'Булчин', menuLabel: 'Булчин', scroll: 0.34 },
    { href: '#slide-3', label: 'Яс', menuLabel: 'Араг яс', scroll: 0.62 },
    { href: '#slide-4', label: 'Эрхтэн', menuLabel: 'Дотор эрхтэн', scroll: 0.94 }
];

// Links without `scroll` point at pages that don't exist yet.
export const header = {
    modelsLabel: 'Загварууд',
    links: [
        { href: '#slide-4', label: 'Биеийн системүүд', scroll: 0.94 },
        { href: '#slide-2', label: 'Онцлог', scroll: 0.34 },
        { href: '#schools', label: 'Сургууль, боловсрол' },
        { href: '#tutorial', label: 'Заавар' },
        { href: '#faq', label: 'Түгээмэл асуулт' },
        { href: '#contact', label: 'Холбоо барих' }
    ] as { href: string; label: string; scroll?: number }[],
    download: { href: '#slide-4', label: 'Татах', scroll: 0.94 },
    menuLabel: 'Цэс'
};

export const hero = {
    title: ['Хүний бие', '3D-ээр'],
    columns: [
        'Эрүүл мэндийн чиглэлээр суралцаж буй оюутнуудад зориулсан интерактив 3D анатомийн атлас. Хүний биеийг давхарга давхаргаар нь нээж, бүтэц бүрийг ойроос судлаарай.',
        'Анагаах ухаан, сувилахуй, нүүр ам судлал, эм зүйн оюутнуудад — лекц, лаборатори, шалгалтын бэлтгэлд. Компьютер, утас, таблет дээрээ хаанаас ч нээгээрэй.'
    ]
};

export const muscles = {
    title: ['Булчингийн', 'систем'],
    text: 'Арьсыг нэг гүйлгээгээр хуулж, 400 гаруй булчинг бодит байрлал, харьцаагаар нь хар. Бүтэц дээр хулганаа аваачих эсвэл хуруугаараа дарахад нэр нь гарч ирнэ.'
};

export const atlasStats = {
    kicker: 'Атласын хүрээ',
    items: [
        { value: '2 100+', label: 'анатомийн бүтэц' },
        { value: '440', label: 'булчин, шөрмөс' },
        { value: '296', label: 'яс, шүд' },
        { value: '6', label: 'давхарга' }
    ]
};

export const skeleton = {
    title: ['Араг яс'],
    text: 'Гавлын яснаас хөлийн шагай хүртэл бүх ясыг эргүүлж, ойртуулж, ар талаас нь хар. Остеологийн хичээл, практикт зориулсан тод, нарийн загвар.'
};

export const organs = {
    title: ['Дотор', 'эрхтэн'],
    text: 'Зүрх, элэг, ходоод, гэдэс, бөөр, тархи — цусны судас, мэдрэлийн замтай нь хамт. Анатомийг цээжлэх биш, ойлгож сур.',
    cta: 'Үнэгүй эхлэх'
};

export const layerLabels: Record<LayerName, string> = {
    skin: 'Арьс',
    muscles: 'Булчин',
    skeleton: 'Яс',
    organs: 'Дотор эрхтэн',
    vessels: 'Судас',
    nerves: 'Мэдрэл'
};

export const loadingLabel = 'Анатомийн загвар ачаалж байна';

export const credit = {
    prefix: '3D өгөгдөл:',
    source: { label: 'BodyParts3D © DBCLS', href: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html' },
    license: { label: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' }
};
