import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const avatars = [
  {
    name: 'cartoon-admin',
    legacyHash: '62cd7ca13a42d9f02a51dc486a2c7d4691b6244d4253fdf83a8588bdecc4b683',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-admin" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff6b6b"/>
      <stop offset="100%" stop-color="#ff4757"/>
    </linearGradient>
    <clipPath id="circle-clip">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip)">
    <rect width="120" height="120" fill="url(#bg-admin)"/>
    <!-- Cute Blogger / Captain Bear -->
    <!-- Ears -->
    <circle cx="36" cy="38" r="14" fill="#f8c291"/>
    <circle cx="36" cy="38" r="8" fill="#e55039"/>
    <circle cx="84" cy="38" r="14" fill="#f8c291"/>
    <circle cx="84" cy="38" r="8" fill="#e55039"/>
    <!-- Head -->
    <circle cx="60" cy="62" r="34" fill="#fed330"/>
    <!-- Cheeks -->
    <circle cx="40" cy="70" r="6" fill="#ff7675" opacity="0.6"/>
    <circle cx="80" cy="70" r="6" fill="#ff7675" opacity="0.6"/>
    <!-- Cool Sunglasses -->
    <rect x="34" y="52" width="22" height="14" rx="4" fill="#2d3436"/>
    <rect x="64" y="52" width="22" height="14" rx="4" fill="#2d3436"/>
    <rect x="54" y="56" width="12" height="3" fill="#2d3436"/>
    <line x1="36" y1="54" x2="44" y2="62" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
    <line x1="66" y1="54" x2="74" y2="62" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
    <!-- Snout & Smile -->
    <ellipse cx="60" cy="72" rx="10" ry="7" fill="#ffffff"/>
    <polygon points="56,69 64,69 60,73" fill="#2d3436"/>
    <path d="M 57 74 Q 60 77 63 74" stroke="#2d3436" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- Crown -->
    <polygon points="46,30 50,38 60,32 70,38 74,30 68,40 52,40" fill="#ffa801"/>
    <circle cx="60" cy="32" r="2.5" fill="#ffffff"/>
    <!-- Body / Collar -->
    <path d="M 32 106 C 32 88 88 88 88 106 Z" fill="#2c3e50"/>
    <polygon points="60,94 54,104 66,104" fill="#e74c3c"/>
  </g>
</svg>`
  },
  {
    name: 'cartoon-1', // Panda
    legacyHash: 'eab1429208ab23ca739b2af4379b0a303ea2993f528a6be3d251653bd883ebad',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-panda" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a8e6cf"/>
      <stop offset="100%" stop-color="#56ab2f"/>
    </linearGradient>
    <clipPath id="circle-clip-1">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip-1)">
    <rect width="120" height="120" fill="url(#bg-panda)"/>
    <!-- Ears -->
    <circle cx="34" cy="34" r="14" fill="#2f3542"/>
    <circle cx="86" cy="34" r="14" fill="#2f3542"/>
    <!-- Body -->
    <ellipse cx="60" cy="105" rx="36" ry="24" fill="#2f3542"/>
    <ellipse cx="60" cy="108" rx="20" ry="16" fill="#ffffff"/>
    <!-- Head -->
    <circle cx="60" cy="62" r="34" fill="#ffffff"/>
    <!-- Eye Patches -->
    <ellipse cx="45" cy="58" rx="9" ry="12" fill="#2f3542" transform="rotate(-15 45 58)"/>
    <ellipse cx="75" cy="58" rx="9" ry="12" fill="#2f3542" transform="rotate(15 75 58)"/>
    <!-- Eyes -->
    <circle cx="46" cy="57" r="3.5" fill="#ffffff"/>
    <circle cx="47" cy="56" r="1.5" fill="#2f3542"/>
    <circle cx="74" cy="57" r="3.5" fill="#ffffff"/>
    <circle cx="73" cy="56" r="1.5" fill="#2f3542"/>
    <!-- Cheeks -->
    <circle cx="37" cy="68" r="6" fill="#ffb8b8" opacity="0.7"/>
    <circle cx="83" cy="68" r="6" fill="#ffb8b8" opacity="0.7"/>
    <!-- Nose & Mouth -->
    <ellipse cx="60" cy="66" rx="5" ry="3.5" fill="#2f3542"/>
    <path d="M 56 71 Q 60 75 64 71" stroke="#2f3542" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- Bamboo leaf -->
    <path d="M 68 76 Q 78 72 82 78 Q 76 82 68 76 Z" fill="#2ed573"/>
  </g>
</svg>`
  },
  {
    name: 'cartoon-2', // Fox
    legacyHash: 'd0d920f650cedaed7d5e6791e23bb258676ae0551d988c8dcbd022d039602953',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-fox" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffd3a5"/>
      <stop offset="100%" stop-color="#fd6585"/>
    </linearGradient>
    <clipPath id="circle-clip-2">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip-2)">
    <rect width="120" height="120" fill="url(#bg-fox)"/>
    <!-- Ears -->
    <polygon points="26,48 40,16 54,42" fill="#e67e22"/>
    <polygon points="32,44 40,24 48,40" fill="#ffffff"/>
    <polygon points="94,48 80,16 66,42" fill="#e67e22"/>
    <polygon points="88,44 80,24 72,40" fill="#ffffff"/>
    <!-- Head -->
    <ellipse cx="60" cy="62" rx="34" ry="30" fill="#e67e22"/>
    <!-- White Snout mask -->
    <path d="M 28 62 Q 60 48 92 62 Q 88 88 60 92 Q 32 88 28 62 Z" fill="#ffffff"/>
    <!-- Eyes -->
    <ellipse cx="44" cy="58" rx="3" ry="4.5" fill="#2d3436"/>
    <circle cx="43" cy="56" r="1.5" fill="#ffffff"/>
    <ellipse cx="76" cy="58" rx="3" ry="4.5" fill="#2d3436"/>
    <circle cx="75" cy="56" r="1.5" fill="#ffffff"/>
    <!-- Cheeks -->
    <circle cx="36" cy="68" r="5" fill="#ff7675" opacity="0.6"/>
    <circle cx="84" cy="68" r="5" fill="#ff7675" opacity="0.6"/>
    <!-- Nose & Mouth -->
    <ellipse cx="60" cy="74" rx="4" ry="3" fill="#2d3436"/>
    <path d="M 57 79 Q 60 82 63 79" stroke="#2d3436" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <!-- Body -->
    <path d="M 32 108 C 32 94 88 94 88 108 Z" fill="#d35400"/>
    <path d="M 52 108 C 52 98 68 98 68 108 Z" fill="#ffffff"/>
  </g>
</svg>`
  },
  {
    name: 'cartoon-3', // Cat
    legacyHash: '39e6194ef5394f1c5c717b302f588b98eb65e462f34c63acdb14a8da8925525a',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-cat" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#89f7fe"/>
      <stop offset="100%" stop-color="#66a6ff"/>
    </linearGradient>
    <clipPath id="circle-clip-3">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip-3)">
    <rect width="120" height="120" fill="url(#bg-cat)"/>
    <!-- Ears -->
    <polygon points="28,45 36,18 52,40" fill="#f5f6fa"/>
    <polygon points="32,42 37,25 46,38" fill="#ffb8b8"/>
    <polygon points="92,45 84,18 68,40" fill="#f5f6fa"/>
    <polygon points="88,42 83,25 74,38" fill="#ffb8b8"/>
    <!-- Head -->
    <circle cx="60" cy="62" r="34" fill="#f5f6fa"/>
    <!-- Yellow Bell / Scarf -->
    <path d="M 36 96 Q 60 106 84 96" stroke="#e84118" stroke-width="8" fill="none" stroke-linecap="round"/>
    <circle cx="60" cy="103" r="6" fill="#fbc531"/>
    <!-- Eyes -->
    <path d="M 40 56 Q 46 51 52 56" stroke="#2f3640" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M 68 56 Q 74 51 80 56" stroke="#2f3640" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <!-- Nose & Mouth -->
    <polygon points="58,63 62,63 60,66" fill="#ff7675"/>
    <path d="M 56 68 Q 60 71 60 67 Q 60 71 64 68" stroke="#2f3640" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <!-- Whiskers -->
    <line x1="28" y1="62" x2="42" y2="64" stroke="#718093" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="26" y1="70" x2="42" y2="68" stroke="#718093" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="92" y1="62" x2="78" y2="64" stroke="#718093" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="94" y1="70" x2="78" y2="68" stroke="#718093" stroke-width="1.5" stroke-linecap="round"/>
    <!-- Cheeks -->
    <circle cx="38" cy="69" r="6" fill="#ff9ff3" opacity="0.6"/>
    <circle cx="82" cy="69" r="6" fill="#ff9ff3" opacity="0.6"/>
  </g>
</svg>`
  },
  {
    name: 'cartoon-4', // Shiba Inu
    legacyHash: '5515f18d7b76781ec78bf7d10699539c82b63ced438609356694bf159426dbc8',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-shiba" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f6d365"/>
      <stop offset="100%" stop-color="#fda085"/>
    </linearGradient>
    <clipPath id="circle-clip-4">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip-4)">
    <rect width="120" height="120" fill="url(#bg-shiba)"/>
    <!-- Ears -->
    <polygon points="26,45 38,15 54,38" fill="#e17055"/>
    <polygon points="32,40 38,23 48,36" fill="#ffffff"/>
    <polygon points="94,45 82,15 66,38" fill="#e17055"/>
    <polygon points="88,40 82,23 72,36" fill="#ffffff"/>
    <!-- Head -->
    <circle cx="60" cy="62" r="34" fill="#e17055"/>
    <!-- Eyebrows white spots -->
    <ellipse cx="46" cy="46" rx="4" ry="3" fill="#ffffff"/>
    <ellipse cx="74" cy="46" rx="4" ry="3" fill="#ffffff"/>
    <!-- White Muzzle -->
    <path d="M 34 68 Q 60 56 86 68 Q 80 92 60 92 Q 40 92 34 68 Z" fill="#ffffff"/>
    <!-- Eyes -->
    <ellipse cx="46" cy="56" rx="3.5" ry="4" fill="#2d3436"/>
    <circle cx="45" cy="54.5" r="1.5" fill="#ffffff"/>
    <ellipse cx="74" cy="56" rx="3.5" ry="4" fill="#2d3436"/>
    <circle cx="73" cy="54.5" r="1.5" fill="#ffffff"/>
    <!-- Nose & Mouth & Tongue -->
    <ellipse cx="60" cy="67" rx="5" ry="3.5" fill="#2d3436"/>
    <path d="M 55 72 Q 60 76 65 72" stroke="#2d3436" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M 57 74 Q 60 82 63 74 Z" fill="#ff7675"/>
    <!-- Cheeks -->
    <circle cx="36" cy="71" r="5.5" fill="#ff7675" opacity="0.6"/>
    <circle cx="84" cy="71" r="5.5" fill="#ff7675" opacity="0.6"/>
    <!-- Green Bandana -->
    <path d="M 32 98 Q 60 110 88 98 L 60 118 Z" fill="#00b894"/>
  </g>
</svg>`
  },
  {
    name: 'cartoon-5', // Bear
    legacyHash: '68f7ffc5f7018962de93a4b0196669c22b1c2cabb8b6f5482e5847625e7f6f7f',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-bear" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#cd9cf2"/>
      <stop offset="100%" stop-color="#f6f3ff"/>
    </linearGradient>
    <clipPath id="circle-clip-5">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip-5)">
    <rect width="120" height="120" fill="url(#bg-bear)"/>
    <!-- Ears -->
    <circle cx="34" cy="36" r="13" fill="#8c7ae6"/>
    <circle cx="34" cy="36" r="7" fill="#f8c291"/>
    <circle cx="86" cy="36" r="13" fill="#8c7ae6"/>
    <circle cx="86" cy="36" r="7" fill="#f8c291"/>
    <!-- Head -->
    <circle cx="60" cy="62" r="34" fill="#8c7ae6"/>
    <!-- Snout -->
    <ellipse cx="60" cy="70" rx="14" ry="10" fill="#f5f6fa"/>
    <ellipse cx="60" cy="66" rx="6" ry="4" fill="#2f3640"/>
    <path d="M 56 71 Q 60 75 64 71" stroke="#2f3640" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- Eyes -->
    <circle cx="44" cy="56" r="3.5" fill="#2f3640"/>
    <circle cx="43" cy="54.5" r="1.2" fill="#ffffff"/>
    <circle cx="76" cy="56" r="3.5" fill="#2f3640"/>
    <circle cx="75" cy="54.5" r="1.2" fill="#ffffff"/>
    <!-- Cheeks -->
    <circle cx="38" cy="68" r="5" fill="#e056fd" opacity="0.6"/>
    <circle cx="82" cy="68" r="5" fill="#e056fd" opacity="0.6"/>
    <!-- Scarf -->
    <path d="M 34 94 C 34 88 86 88 86 94 L 82 108 L 38 108 Z" fill="#f0932b"/>
    <rect x="52" y="98" width="16" height="18" fill="#f0932b" rx="2"/>
  </g>
</svg>`
  },
  {
    name: 'cartoon-6', // Bunny
    legacyHash: 'aabd0e4e9a4aa4dc572e20d04a1a9d9589e83df2f673eacf200fa8817015c7e1',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-bunny" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff9a9e"/>
      <stop offset="100%" stop-color="#fecfef"/>
    </linearGradient>
    <clipPath id="circle-clip-6">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip-6)">
    <rect width="120" height="120" fill="url(#bg-bunny)"/>
    <!-- Ears -->
    <ellipse cx="44" cy="28" rx="8" ry="22" fill="#ffffff"/>
    <ellipse cx="44" cy="30" rx="4.5" ry="16" fill="#ffb8b8"/>
    <ellipse cx="76" cy="28" rx="8" ry="22" fill="#ffffff"/>
    <ellipse cx="76" cy="30" rx="4.5" ry="16" fill="#ffb8b8"/>
    <!-- Head -->
    <circle cx="60" cy="66" r="32" fill="#ffffff"/>
    <!-- Eyes -->
    <ellipse cx="46" cy="62" rx="3.5" ry="5" fill="#2d3436"/>
    <circle cx="45" cy="60" r="1.5" fill="#ffffff"/>
    <ellipse cx="74" cy="62" rx="3.5" ry="5" fill="#2d3436"/>
    <circle cx="73" cy="60" r="1.5" fill="#ffffff"/>
    <!-- Cheeks -->
    <circle cx="36" cy="72" r="6" fill="#ff7675" opacity="0.6"/>
    <circle cx="84" cy="72" r="6" fill="#ff7675" opacity="0.6"/>
    <!-- Nose & Mouth -->
    <polygon points="58,69 62,69 60,72" fill="#ff7675"/>
    <path d="M 56 74 Q 60 77 64 74" stroke="#2d3436" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <!-- Carrot -->
    <polygon points="56,92 64,92 60,104" fill="#e67e22"/>
    <path d="M 60,92 L 56,86 M 60,92 L 64,86" stroke="#27ae60" stroke-width="2" stroke-linecap="round"/>
  </g>
</svg>`
  },
  {
    name: 'cartoon-7', // Penguin
    legacyHash: '3086e52a01aa5df6c1ab374486c6a49db16665dec3eea2c919be71463ef1ed6a',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-penguin" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4facfe"/>
      <stop offset="100%" stop-color="#00f2fe"/>
    </linearGradient>
    <clipPath id="circle-clip-7">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip-7)">
    <rect width="120" height="120" fill="url(#bg-penguin)"/>
    <!-- Body -->
    <ellipse cx="60" cy="66" rx="34" ry="36" fill="#2f3542"/>
    <!-- White Belly / Face -->
    <ellipse cx="60" cy="70" rx="24" ry="28" fill="#ffffff"/>
    <!-- Eyes -->
    <ellipse cx="48" cy="58" rx="3.5" ry="4.5" fill="#2f3542"/>
    <circle cx="47" cy="56.5" r="1.5" fill="#ffffff"/>
    <ellipse cx="72" cy="58" rx="3.5" ry="4.5" fill="#2f3542"/>
    <circle cx="71" cy="56.5" r="1.5" fill="#ffffff"/>
    <!-- Cheeks -->
    <circle cx="40" cy="66" r="5" fill="#ff4757" opacity="0.6"/>
    <circle cx="80" cy="66" r="5" fill="#ff4757" opacity="0.6"/>
    <!-- Beak -->
    <polygon points="54,64 66,64 60,73" fill="#ffa502"/>
    <!-- Winter Earmuffs -->
    <path d="M 28 52 A 32 32 0 0 1 92 52" stroke="#ff4757" stroke-width="4" fill="none"/>
    <circle cx="28" cy="54" r="9" fill="#ff4757"/>
    <circle cx="28" cy="54" r="5" fill="#ffffff"/>
    <circle cx="92" cy="54" r="9" fill="#ff4757"/>
    <circle cx="92" cy="54" r="5" fill="#ffffff"/>
  </g>
</svg>`
  },
  {
    name: 'cartoon-8', // Astronaut
    legacyHash: 'be129e030c82d4ee30ae90130ab37a6abbf7d134ad2d5e7356949fd95a33108b',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="bg-astro" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#302b63"/>
      <stop offset="100%" stop-color="#24243e"/>
    </linearGradient>
    <linearGradient id="visor-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00c6ff"/>
      <stop offset="100%" stop-color="#0072ff"/>
    </linearGradient>
    <clipPath id="circle-clip-8">
      <circle cx="60" cy="60" r="60"/>
    </clipPath>
  </defs>
  <g clip-path="url(#circle-clip-8)">
    <rect width="120" height="120" fill="url(#bg-astro)"/>
    <!-- Stars -->
    <circle cx="24" cy="20" r="1.5" fill="#ffffff" opacity="0.8"/>
    <circle cx="98" cy="26" r="1.2" fill="#ffffff" opacity="0.8"/>
    <circle cx="86" cy="94" r="1.5" fill="#ffffff" opacity="0.8"/>
    <!-- Helmet Base -->
    <rect x="28" y="24" width="64" height="60" rx="26" fill="#f1f2f6"/>
    <rect x="36" y="78" width="48" height="10" rx="5" fill="#ced6e0"/>
    <!-- Visor -->
    <rect x="36" y="34" width="48" height="38" rx="14" fill="url(#visor-grad)"/>
    <!-- Cute Eyes inside helmet -->
    <ellipse cx="50" cy="52" rx="3.5" ry="5" fill="#ffffff"/>
    <circle cx="49" cy="50" r="1.5" fill="#0072ff"/>
    <ellipse cx="70" cy="52" rx="3.5" ry="5" fill="#ffffff"/>
    <circle cx="69" cy="50" r="1.5" fill="#0072ff"/>
    <!-- Visor shine -->
    <path d="M 40 40 Q 56 36 74 44" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/>
    <!-- Space Suit Body -->
    <path d="M 30 96 C 30 86 90 86 90 96 L 90 120 L 30 120 Z" fill="#f1f2f6"/>
    <circle cx="60" cy="100" r="4" fill="#ff4757"/>
  </g>
</svg>`
  }
];

const targetDirs = [
  path.join(process.cwd(), 'public', 'assets', 'images', 'avatars'),
  path.join(process.cwd(), 'assets', 'images', 'avatars')
];

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function buildAvatars() {
  console.log('Generating high-definition vector cartoon avatars...');

  for (const item of avatars) {
    const svgBuffer = Buffer.from(item.svg);

    for (const dir of targetDirs) {
      // 1. 保存标准命名 SVG / PNG / WEBP / JPG
      const svgPath = path.join(dir, `${item.name}.svg`);
      fs.writeFileSync(svgPath, svgBuffer);

      const pngBuffer = await sharp(svgBuffer).resize(120, 120).png().toBuffer();
      const jpgBuffer = await sharp(svgBuffer).resize(120, 120).jpeg({ quality: 92 }).toBuffer();
      const webpBuffer = await sharp(svgBuffer).resize(120, 120).webp({ quality: 92 }).toBuffer();

      fs.writeFileSync(path.join(dir, `${item.name}.png`), pngBuffer);
      fs.writeFileSync(path.join(dir, `${item.name}.jpg`), jpgBuffer);
      fs.writeFileSync(path.join(dir, `${item.name}.webp`), webpBuffer);

      // 2. 覆盖旧版哈希文件 (彻底消除真实人脸，保持 KV 历史数据自动生效)
      if (item.legacyHash) {
        fs.writeFileSync(path.join(dir, `${item.legacyHash}.jpg`), jpgBuffer);
        fs.writeFileSync(path.join(dir, `${item.legacyHash}.webp`), webpBuffer);
      }
    }

    console.log(`[OK] Generated cartoon avatar: ${item.name} (linked to legacy: ${item.legacyHash})`);
  }

  console.log('All cartoon avatars generated and mapped successfully!');
}

buildAvatars().catch(console.error);
