'use strict';
/*
 * PROTOCOL 88 — localization.
 * English is the source text: the game passes its English strings through I18N.t(), which looks
 * them up in the active language's table and falls back to the English text when there is no
 * entry. Templates use numbered slots: t('WAVE {0} CLEARED', 5). A translation may reorder slots.
 * Game data (alien, weapon, perk names...) stays English inside the game and is translated only
 * when drawn, so logic that keys off those names keeps working in every language.
 */
(() => {
  const RU = {
    // ---- boot console + rotate screen (index.html)
    'P88 TACTICAL OS  v8.8': 'P88 ТАКТИЧЕСКАЯ ОС  v8.8',
    '(C) 2088 ORBITAL DEFENSE CMD': '(C) 2088 ШТАБ ОРБИТАЛЬНОЙ ОБОРОНЫ',
    'MEMORY CHECK ........ OK': 'ПРОВЕРКА ПАМЯТИ ..... OK',
    'WEAPON UPLINK ....... OK': 'КАНАЛ ОРУЖИЯ ........ OK',
    'HOSTILE SIGNATURES .. 4812': 'ВРАЖЕСКИЕ ЦЕЛИ ...... 4812',
    '> AUTHORIZATION REQUIRED': '> ТРЕБУЕТСЯ АВТОРИЗАЦИЯ',
    '> PROTOCOL NUMBER:': '> НОМЕР ПРОТОКОЛА:',
    '> ACCESS GRANTED': '> ДОСТУП РАЗРЕШЁН',
    '> SWITCHING TO COMBAT VIEW': '> ПЕРЕХОД В БОЕВОЙ РЕЖИМ',
    '> DEPLOYING PROTOCOL 88': '> ЗАПУСК ПРОТОКОЛА 88',
    '> ROTATING...': '> ПОВОРОТ...',
    '> ROTATE DEVICE  >>': '> ПОВЕРНИ УСТРОЙСТВО  >>',
    'TAP TO ANSWER': 'КОСНИСЬ, ЧТОБЫ ОТВЕТИТЬ',
    'TYPE 88 OR CLICK': 'ВВЕДИ 88 ИЛИ КЛИКНИ',
    'Answer 88': 'Ответить 88',
    'Protocol 88 boot console': 'Консоль загрузки Protocol 88',
    'ROTATE DEVICE': 'ПОВЕРНИ УСТРОЙСТВО',
    'PROTOCOL 88 RUNS IN LANDSCAPE': 'ИГРА РАБОТАЕТ В АЛЬБОМНОМ РЕЖИМЕ',

    // ---- weapons (full name, short name)
    'M-88 BLASTER': 'БЛАСТЕР M-88', 'BLASTER': 'БЛАСТЕР',
    'VIPER SMG': 'ПП ГАДЮКА', 'VIPER': 'ГАДЮКА',
    'THUNDER-12': 'ГРОМ-12', 'THUNDER': 'ГРОМ',
    'PULSE RIFLE': 'ИМПУЛЬСНАЯ ВИНТОВКА', 'PULSE': 'ИМПУЛЬС',
    'NUKA LAUNCHER': 'РАКЕТОМЁТ НЮКА', 'NUKA': 'НЮКА',
    'HELLFIRE': 'ПЕКЛО',
    'PHOTON RAIL': 'ФОТОННЫЙ РЕЛЬСОТРОН', 'PHOTON': 'ФОТОН',
    'DEVASTATOR': 'ДЕВАСТАТОР',
    'RIPPER DISC': 'ДИСК-РЕЗАК', 'RIPPER': 'РЕЗАК',
    'ARC CASTER': 'ДУГОМЁТ', 'ARC': 'ДУГА',

    // ---- aliens
    'CRAWLER': 'ПОЛЗУН', 'FAST. HUNGRY. MANY.': 'БЫСТРЫЕ. ГОЛОДНЫЕ. ИХ МНОГО.',
    'LEAPER': 'ПРЫГУН', 'POUNCES FROM RANGE': 'НАПРЫГИВАЕТ ИЗДАЛЕКА',
    'SPITTER': 'ПЛЕВУН', 'KEEPS DISTANCE. SPITS ACID.': 'ДЕРЖИТ ДИСТАНЦИЮ. ПЛЮЁТСЯ КИСЛОТОЙ.',
    'BRUTE': 'ГРОМИЛА', 'ARMORED. CHARGES.': 'В БРОНЕ. ИДЁТ НА ТАРАН.',
    'BOOMER': 'ВЗРЫВУН', 'EXPLODES. CHAIN THEM.': 'ВЗРЫВАЕТСЯ. ПОДРЫВАЙ ЦЕПОЧКОЙ.',
    'PHANTOM': 'ФАНТОМ', 'CLOAKS IN THE DARK.': 'НЕВИДИМ В ТЕМНОТЕ.',
    'BURROWER': 'ЗЕМЛЕРОЙ', 'TUNNELS UNDER YOUR FEET.': 'РОЕТ ХОДЫ ПОД НОГАМИ.',
    'WARDEN': 'СТРАЖ', 'FRONT SHIELD. FLANK IT.': 'ЩИТ СПЕРЕДИ. ЗАХОДИ С ФЛАНГА.',
    'HATCHER': 'ИНКУБАТОР', 'LAYS EGGS. BURSTS INTO MITES.': 'ОТКЛАДЫВАЕТ ЯЙЦА. ЛОПАЕТСЯ НА КЛЕЩЕЙ.',
    'STINGER': 'ЖАЛОНОС', 'FLIES OVER COVER. DIVES.': 'ЛЕТАЕТ НАД УКРЫТИЯМИ. ПИКИРУЕТ.',
    'MITE': 'КЛЕЩ', 'EGG': 'ЯЙЦО',
    'HIVE QUEEN': 'КОРОЛЕВА УЛЬЯ', 'THE HIVE QUEEN AWAKENS': 'КОРОЛЕВА УЛЬЯ ПРОБУЖДАЕТСЯ',
    'SPECIMEN X': 'ОБРАЗЕЦ X', 'SOMETHING BROKE OUT OF ITS TANK': 'ЧТО-ТО ВЫРВАЛОСЬ ИЗ КАПСУЛЫ',
    'BROOD TITAN': 'ТИТАН ВЫВОДКА', 'THE NEST PROTECTS ITS MOTHER': 'ГНЕЗДО ЗАЩИЩАЕТ СВОЮ МАТЬ',
    'MOLTEN BEHEMOTH': 'ОГНЕННЫЙ БЕГЕМОТ', 'THE CORE HAS A GUARDIAN': 'У ЯДРА ЕСТЬ СТРАЖ',
    'HIVE QUEEN SLAIN': 'КОРОЛЕВА УЛЬЯ ПОВЕРЖЕНА',
    'SPECIMEN X SLAIN': 'ОБРАЗЕЦ X УНИЧТОЖЕН',
    'BROOD TITAN SLAIN': 'ТИТАН ВЫВОДКА ПОВЕРЖЕН',
    'MOLTEN BEHEMOTH SLAIN': 'ОГНЕННЫЙ БЕГЕМОТ ПОВЕРЖЕН',

    // ---- wave taunts
    'THEY SMELL YOU': 'ОНИ ЧУЮТ ТЕБЯ', 'HOLD THE LINE': 'ДЕРЖИ ОБОРОНУ', 'NO RETREAT': 'НИ ШАГУ НАЗАД',
    'MORE OF THEM': 'ИХ ВСЁ БОЛЬШЕ', 'THE HIVE IS ANGRY': 'УЛЕЙ В ГНЕВЕ', 'LOCK AND LOAD': 'ЗАРЯЖАЙ', 'KEEP MOVING': 'НЕ СТОЙ НА МЕСТЕ',

    // ---- gear
    'KEVLAR-X ARMOR': 'БРОНЯ КЕВЛАР-X', '-12% DAMAGE TAKEN': '-12% ПОЛУЧАЕМОГО УРОНА',
    'VITAL CORE': 'ЯДРО ЖИЗНИ', '+25 MAX HEALTH': '+25 К МАКС. ЗДОРОВЬЮ',
    'AEGIS EMITTER': 'ЭМИТТЕР ЭГИДА', '+30 REGENERATING SHIELD': 'ЩИТ +30 С РЕГЕНЕРАЦИЕЙ',
    'SERVO BOOTS': 'СЕРВОБОТИНКИ', '+8% SPEED, FASTER DASH': '+8% СКОРОСТИ, БЫСТРЕЕ РЫВОК',
    'SENTRY DRONE': 'ДРОН-ОХРАННИК', 'AUTO-FIRING COMPANION': 'НАПАРНИК С АВТОСТРЕЛЬБОЙ',
    'FIELD SURGEON': 'ПОЛЕВОЙ ХИРУРГ', 'FULL HEAL': 'ПОЛНОЕ ЛЕЧЕНИЕ', 'FULLY PATCHED UP': 'КАК НОВЕНЬКИЙ',
    'GUNSMITH': 'ОРУЖЕЙНИК', '+1 LEVEL TO HELD WEAPON': '+1 УРОВЕНЬ ТЕКУЩЕМУ ОРУЖИЮ',

    // ---- power-ups
    'OVERDRIVE': 'ФОРСАЖ', 'INVULNERABLE': 'НЕУЯЗВИМОСТЬ', 'CHRONO FIELD': 'ХРОНОПОЛЕ', 'NOVA BLAST': 'СВЕРХНОВАЯ',

    // ---- perks
    'INCENDIARY ROUNDS': 'ЗАЖИГАТЕЛЬНЫЕ ПАТРОНЫ', 'HITS CAN IGNITE ALIENS': 'ПОПАДАНИЯ ПОДЖИГАЮТ ЧУЖИХ', 'IGNITE CHANCE DOUBLED': 'ШАНС ПОДЖОГА X2',
    'AFTERBURNER': 'ОГНЕННЫЙ СЛЕД', 'DASH LEAVES A FIRE TRAIL': 'РЫВОК ОСТАВЛЯЕТ ОГОНЬ', 'WIDER, LONGER TRAIL': 'СЛЕД ШИРЕ И ДЛИННЕЕ',
    'PYROMANIAC': 'ПИРОМАН', 'BURNING ALIENS EXPLODE': 'ГОРЯЩИЕ ЧУЖИЕ ВЗРЫВАЮТСЯ', 'BIGGER DEATH BLASTS': 'ВЗРЫВЫ МОЩНЕЕ',
    'A FIRE PERK': 'ОГНЕННЫЙ ПЕРК',
    'CHAIN REACTION': 'ЦЕПНАЯ РЕАКЦИЯ', 'KILLS MAY DETONATE': 'УБИТЫЕ МОГУТ ВЗОРВАТЬСЯ', 'DETONATE TWICE AS OFTEN': 'ВЗРЫВЫ ВДВОЕ ЧАЩЕ',
    'KINETIC DASH': 'КИНЕТИЧЕСКИЙ РЫВОК', 'DASH ENDS IN A SHOCKWAVE': 'РЫВОК БЬЁТ УДАРНОЙ ВОЛНОЙ', 'BIGGER, ERASES SPIT': 'ВОЛНА ШИРЕ, СБИВАЕТ ПЛЕВКИ',
    'RICOCHET': 'РИКОШЕТ', 'BULLETS BOUNCE ONCE': 'ПУЛИ ОТСКАКИВАЮТ 1 РАЗ', 'BULLETS BOUNCE TWICE': 'ПУЛИ ОТСКАКИВАЮТ 2 РАЗА',
    'FRENZY': 'НЕИСТОВСТВО', 'KILLS: +2% FIRE RATE': 'УБИЙСТВА: +2% К СТРЕЛЬБЕ', '+3% PER KILL, CAP 50%': '+3% ЗА УБИЙСТВО, ДО 50%',
    'HOT STREAK': 'В УДАРЕ', 'X4 COMBO: OVERDRIVE': 'КОМБО X4: ФОРСАЖ', 'X4 AND X8: LONGER': 'X4 И X8: ДОЛЬШЕ', 'HOT STREAK!': 'В УДАРЕ!',
    'STATIC FIELD': 'СТАТИЧЕСКОЕ ПОЛЕ', 'EVERY 12 KILLS: LIGHTNING': 'КАЖДЫЕ 12 УБИЙСТВ: МОЛНИЯ', 'EVERY 8 KILLS, MORE ARCS': 'КАЖДЫЕ 8 УБИЙСТВ, БОЛЬШЕ ДУГ',
    'BLOODLUST': 'ЖАЖДА КРОВИ', 'KILLS HEAL, MORE WHEN LOW': 'УБИЙСТВА ЛЕЧАТ, ПРИ РАНЕНИИ СИЛЬНЕЕ', 'KILLS HEAL TWICE AS MUCH': 'УБИЙСТВА ЛЕЧАТ ВДВОЕ СИЛЬНЕЕ',
    'DRONE LINK': 'СВЯЗЬ С ДРОНОМ', 'DRONES FIRE 2X, PIERCE': 'ДРОНЫ БЬЮТ X2 И НАСКВОЗЬ', 'DRONES USE YOUR PERKS': 'ДРОНЫ ИСПОЛЬЗУЮТ ТВОИ ПЕРКИ',
    'A SENTRY DRONE': 'ДРОН-ОХРАННИК',
    'SCAVENGER': 'МАРОДЁР', 'BIG MAGNET, MORE AMMO': 'СИЛЬНЫЙ МАГНИТ, БОЛЬШЕ ПАТРОНОВ',

    // ---- elite traits (adjectives that sit before a masculine alien name, or alone on the tag)
    'SWIFT': 'БЫСТРЫЙ', 'REGENERATING': 'ЖИВУЧИЙ', 'SPLITTER': 'ДЕЛЯЩИЙСЯ', 'VOLATILE': 'НЕСТАБИЛЬНЫЙ', 'TOXIC': 'ЯДОВИТЫЙ', 'COMMANDER': 'ВОЖАК',
    'VOLATILE {0}': 'НЕСТАБИЛЬНЫЙ {0}',

    // ---- wave twists
    'BLACKOUT': 'ТЕМНОТА', 'THE LIGHTS ARE OUT': 'СВЕТ ПОГАС',
    'SWARM': 'РОЙ', 'TWICE AS MANY, HALF AS TOUGH': 'ВДВОЕ БОЛЬШЕ, ВДВОЕ СЛАБЕЕ',
    'AMBUSH': 'ЗАСАДА', 'THEY POUR OUT OF EVERY VENT': 'ОНИ ЛЕЗУТ ИЗ ВСЕХ ЛЮКОВ',
    'ACID RAIN': 'КИСЛОТНЫЙ ДОЖДЬ', 'WATCH THE SKY': 'СЛЕДИ ЗА НЕБОМ',
    'BOUNTY': 'ОХОТА', 'HUNT THE MARKED ONE BEFORE IT ESCAPES': 'УБЕЙ МЕЧЕНОГО, ПОКА ОН НЕ СБЕЖАЛ',
    'BLOOD MOON': 'КРОВАВАЯ ЛУНА', 'FASTER ALIENS, DOUBLE SCORE': 'ЧУЖИЕ БЫСТРЕЕ, ОЧКИ X2',

    // ---- starting kits
    'STANDARD ISSUE': 'ШТАТНЫЙ', 'M-88 BLASTER. THAT IS ALL.': 'БЛАСТЕР M-88. И НИЧЕГО БОЛЬШЕ.',
    'ASSAULT': 'ШТУРМОВИК', 'STARTS WITH THE VIPER SMG': 'СТАРТ С ПП ГАДЮКА', 'REACH WAVE 5': 'ДОЙДИ ДО 5-Й ВОЛНЫ',
    'BREACHER': 'ВЗЛОМЩИК', 'THUNDER-12 + KEVLAR ARMOR': 'ГРОМ-12 + БРОНЯ КЕВЛАР-X', 'KILL THE HIVE QUEEN': 'УБЕЙ КОРОЛЕВУ УЛЬЯ',
    'PYRO': 'ПОДЖИГАТЕЛЬ', 'HELLFIRE + INCENDIARY ROUNDS': 'ПЕКЛО + ЗАЖИГАТЕЛЬНЫЕ ПАТРОНЫ', 'BURN 150 ALIENS TO DEATH': 'СОЖГИ 150 ЧУЖИХ',
    'GHOST': 'ПРИЗРАК', 'SERVO BOOTS + KINETIC DASH': 'СЕРВОБОТИНКИ + КИНЕТИЧЕСКИЙ РЫВОК', 'SURVIVE 5 WAVE TWISTS': 'ПЕРЕЖИВИ 5 ОСОБЫХ ВОЛН',
    'ENGINEER': 'ИНЖЕНЕР', 'SENTRY DRONE + DRONE LINK': 'ДРОН-ОХРАННИК + СВЯЗЬ С ДРОНОМ', 'REACH WAVE 12': 'ДОЙДИ ДО 12-Й ВОЛНЫ',
    'BOUNTY HUNTER': 'ОХОТНИК ЗА ГОЛОВАМИ', 'PULSE RIFLE + HOT STREAK': 'ИМПУЛЬСНАЯ ВИНТОВКА + В УДАРЕ', 'CLAIM 3 BOUNTIES': 'ДОБУДЬ 3 МЕЧЕНЫХ',
    'DEMOLITION': 'ПОДРЫВНИК', 'NUKA LAUNCHER + CHAIN REACTION': 'РАКЕТОМЁТ НЮКА + ЦЕПНАЯ РЕАКЦИЯ', 'KILL SPECIMEN X': 'УБЕЙ ОБРАЗЕЦ X',

    // ---- arenas and their props
    'SECTOR 88': 'СЕКТОР 88', 'HANGAR DECK': 'АНГАРНАЯ ПАЛУБА',
    'BIOLAB 7': 'БИОЛАБОРАТОРИЯ 7', 'CONTAINMENT FAILED': 'КАРАНТИН НАРУШЕН',
    'THE NEST': 'ГНЕЗДО', 'HIVE INTERIOR': 'ВНУТРИ УЛЬЯ',
    'CORE REACTOR': 'РЕАКТОР', 'MELTDOWN IMMINENT': 'ЯДРО ВОТ-ВОТ РАСПЛАВИТСЯ',
    'FUEL DRUM': 'БОЧКА С ТОПЛИВОМ', 'CRYO CANISTER': 'КРИОКАНИСТРА', 'GAS POD': 'ГАЗОВЫЙ МЕШОК', 'PLASMA CELL': 'ПЛАЗМЕННАЯ ЯЧЕЙКА',
    'EXPLOSIVE BARREL': 'ВЗРЫВООПАСНАЯ БОЧКА',
    'TURRET ONLINE': 'ТУРЕЛЬ АКТИВНА', 'TURRET OFFLINE': 'ТУРЕЛЬ ОТКЛЮЧЕНА',
    'TURRET {0}S': 'ТУРЕЛЬ {0} С', 'RECHARGING {0}S': 'ПЕРЕЗАРЯДКА {0} С', 'STAND HERE TO DEPLOY': 'ВСТАНЬ СЮДА, ЧТОБЫ ЗАПУСТИТЬ', 'TURRET': 'ТУРЕЛЬ',
    'VENT FLARE': 'ВЫБРОС ПЛАМЕНИ', 'THE FLOOR VENTS ARE IGNITING - MOVE': 'ЛЮКИ В ПОЛУ ВСПЫХИВАЮТ - ДВИГАЙСЯ',
    'COOLANT LEAK': 'УТЕЧКА ХЛАДАГЕНТА', 'ALIENS NEAR THE TANKS ARE FREEZING': 'ЧУЖИЕ У БАКОВ ЗАМЕРЗАЮТ',
    'SPORE BURST': 'ВЫБРОС СПОР', 'THE WALLS ARE HATCHING': 'ИЗ СТЕН ЛЕЗЕТ ПОТОМСТВО',
    'CORE FLARE': 'ВСПЫШКА ЯДРА', 'DASH THROUGH THE SHOCKWAVE': 'ПРОРВИСЬ РЫВКОМ СКВОЗЬ ВОЛНУ',
    'UNKNOWN': 'НЕИЗВЕСТНО', 'PLASMA': 'ПЛАЗМА', 'ACID PUDDLE': 'КИСЛОТНАЯ ЛУЖА', 'ACID POOL': 'КИСЛОТНОЕ ОЗЕРО',
    'BURNING!': 'ГОРИШЬ!', 'ACID!': 'КИСЛОТА!',

    // ---- in-run callouts
    'OUT OF AMMO': 'НЕТ ПАТРОНОВ',
    'SYNERGY UNLOCKED: {0}': 'ОТКРЫТА СИНЕРГИЯ: {0}', 'PERK': 'ПЕРК', 'LEVEL {0} - ': 'УРОВЕНЬ {0} - ',
    'SUPPLY DROP': 'СБРОС ПРИПАСОВ', 'GRAB ONE UPGRADE': 'ВОЗЬМИ ОДНО УЛУЧШЕНИЕ',
    'PERFECT DODGE': 'ИДЕАЛЬНЫЙ УВОРОТ',
    // bounty banner: '{0}' is the traits, '{1}' the alien (only used there)
    '{0} {1}': '{1}: {0}',
    'KILL IT WITHIN 45 SECONDS': 'УБЕЙ ЕГО ЗА 45 СЕКУНД',
    'BOUNTY ESCAPED': 'ЦЕЛЬ СБЕЖАЛА', 'IT GOT AWAY': 'ДОБЫЧА УШЛА',
    'BOUNTY CLAIMED': 'ЦЕЛЬ УНИЧТОЖЕНА', 'WEAPON UPGRADE DROPPED': 'ВЫПАЛО УЛУЧШЕНИЕ ОРУЖИЯ',
    'WARNING': 'ТРЕВОГА', '{0} DETECTED': 'ОБНАРУЖЕНА УГРОЗА: {0}',
    'IT IS SHEDDING!': 'ОН ПОРОЖДАЕТ РОЙ!',
    'ENRAGED': 'ЯРОСТЬ', '{0} IS FURIOUS': '{0} В ЯРОСТИ', '  ·  ENRAGED': '  ·  В ЯРОСТИ',
    'MAX COMBO  +21% DMG': 'МАКС. КОМБО  +21% УРОНА',
    'THE HIVE SCREAMS': 'УЛЕЙ ВОЕТ', '+20 MAX HP': '+20 К МАКС. ОЗ', '+35 HP': '+35 ОЗ', 'AMMO': 'ПАТРОНЫ',
    'NEW WEAPON': 'НОВОЕ ОРУЖИЕ', 'EQUIPPED - SLOT {0}': 'В РУКАХ - СЛОТ {0}',
    'WEAPON UPGRADE': 'УЛУЧШЕНИЕ ОРУЖИЯ', '{0} LV {1}': '{0} УР. {1}', '+25% DAMAGE': '+25% УРОНА',
    'WAVE {0}': 'ВОЛНА {0}', 'NEW THREAT: {0}': 'НОВАЯ УГРОЗА: {0}',
    'A GOLDEN CARRIER HAS A WEAPON': 'У ЗОЛОТОГО НОСИТЕЛЯ ЕСТЬ ОРУЖИЕ',
    'WAVE {0} CLEARED': 'ВОЛНА {0} ЗАЧИЩЕНА', '+{0} BONUS': 'БОНУС +{0}',
    '{0} SURVIVED - POWER-UP DROPPED': 'ПЕРЕЖИТО: {0} - ВЫПАЛО УСИЛЕНИЕ',
    'KIT UNLOCKED': 'КОМПЛЕКТ ОТКРЫТ', '{0} - PICK IT ON THE MENU': '{0} - ВЫБЕРИ В МЕНЮ',
    'GET READY': 'ПРИГОТОВЬСЯ', 'SURVIVE AS LONG AS YOU CAN': 'ПРОДЕРЖИСЬ КАК МОЖНО ДОЛЬШЕ', '{0} KIT - {1}': 'КОМПЛЕКТ {0} - {1}',
    'EARLY CALL +{0}': 'ДОСРОЧНЫЙ ВЫЗОВ +{0}', 'POWER-UP DROPPED': 'ВЫПАЛО УСИЛЕНИЕ',
    'GAMEPAD CONNECTED': 'ГЕЙМПАД ПОДКЛЮЧЁН',
    'COMBO ENDED - {0}': 'КОМБО ПРЕРВАНО - {0}',
    'PERK LV {0}': 'ПЕРК УР. {0}', 'NEW PERK': 'НОВЫЙ ПЕРК', 'SYNERGY': 'СИНЕРГИЯ', 'LV {0}': 'УР. {0}', '  LV {0}': '  УР. {0}',

    // ---- options
    'MUSIC VOLUME': 'ГРОМКОСТЬ МУЗЫКИ', 'SFX VOLUME': 'ГРОМКОСТЬ ЗВУКОВ',
    'SOUNDTRACK': 'САУНДТРЕК', 'SYNTH': 'СИНТЕЗАТОР', 'STUDIO': 'СТУДИЯ',
    'SCREEN SHAKE': 'ТРЯСКА ЭКРАНА', 'OFF': 'ВЫКЛ', 'LOW': 'СЛАБО', 'FULL': 'ПОЛНОСТЬЮ',
    'BRIGHTNESS': 'ЯРКОСТЬ', 'DARK': 'ТЕМНО', 'NORMAL': 'НОРМА', 'BRIGHT': 'ЯРКО',
    'POST FX': 'ПОСТЭФФЕКТЫ', 'HIGH': 'ВЫСОКО',
    'SCANLINES': 'РАЗВЁРТКА ЭЛТ', 'ON': 'ВКЛ',
    'LANGUAGE': 'ЯЗЫК / LANGUAGE', // findable by someone who can't read Russian
    'OPTIONS': 'НАСТРОЙКИ', '[Y] OPTIONS': '[Y] НАСТРОЙКИ', '[O] OPTIONS': '[O] НАСТРОЙКИ',
    'TAP OUTSIDE TO CLOSE': 'КОСНИСЬ ЗА ПРЕДЕЛАМИ МЕНЮ, ЧТОБЫ ЗАКРЫТЬ', 'ESC / CLICK OUTSIDE TO CLOSE': 'ESC / КЛИК ВНЕ МЕНЮ - ЗАКРЫТЬ',
    'TAP THE LEFT / RIGHT HALF OF A ROW TO CHANGE IT': 'КАСАЙСЯ ЛЕВОЙ / ПРАВОЙ ПОЛОВИНЫ СТРОКИ, ЧТОБЫ ИЗМЕНИТЬ',
    'ARROWS / D-PAD TO CHANGE  ·  CLICK LEFT / RIGHT HALF OF A ROW': 'СТРЕЛКИ / КРЕСТОВИНА  ·  КЛИК ПО ЛЕВОЙ / ПРАВОЙ ПОЛОВИНЕ СТРОКИ',

    // ---- on-screen touch controls
    'MOVE': 'ДВИЖЕНИЕ', 'AIM + FIRE': 'ПРИЦЕЛ + ОГОНЬ', 'DASH': 'РЫВОК', 'SWAP': 'СМЕНА',

    // ---- HUD
    'VITALS': 'ЗДОРОВЬЕ', 'READY': 'ГОТОВ',
    'LAST {0}  ·  HUNT THEM DOWN': 'ОСТАЛОСЬ {0}  ·  ДОБЕЙ ИХ', '{0} HOSTILES': 'ВРАГОВ: {0}',
    'BOUNTY  ·  {0}S': 'ЦЕЛЬ  ·  {0} С', 'BOUNTY · ': 'ЦЕЛЬ · ',
    'NEXT WAVE IN {0}': 'ВОЛНА ЧЕРЕЗ {0}',
    'TAP': 'ЖМИ', 'BRING IT ON': 'ВЫЗВАТЬ СЕЙЧАС', '  ·  EARN A POWER-UP': '  ·  ПОЛУЧИ УСИЛЕНИЕ',
    'SCORE': 'СЧЁТ', 'KILLS {0}': 'УБИТО {0}', '+{0}% DMG': 'УРОН +{0}%',
    'M  MUSIC OFF': 'M  МУЗЫКА ВЫКЛ', 'M  MUSIC ON': 'M  МУЗЫКА ВКЛ',
    'RELOCATING...': 'ПЕРЕБРОСКА...',
    'BOSS THEME': 'ТЕМА БОССА', 'INTERMISSION': 'ПЕРЕДЫШКА', 'NOW PLAYING  +{0} KEY': 'СЕЙЧАС ИГРАЕТ  +{0} ТОН', 'NOW PLAYING': 'СЕЙЧАС ИГРАЕТ',

    // ---- main menu
    'SURVIVE THE SWARM': 'ВЫСТОЙ ПРОТИВ РОЯ',
    'KIT LOCKED - PICK ANOTHER': 'КОМПЛЕКТ ЗАКРЫТ - ВЫБЕРИ ДРУГОЙ',
    'TAP TO DEPLOY': 'КОСНИСЬ - И В БОЙ!', 'CLICK TO DEPLOY': 'КЛИКНИ - И В БОЙ!', 'CLICK TO POWER ON': 'КЛИКНИ, ЧТОБЫ ВКЛЮЧИТЬ',
    'LEFT THUMB': 'ЛЕВЫЙ ПАЛЕЦ', 'RIGHT THUMB': 'ПРАВЫЙ ПАЛЕЦ', 'DASH / DOUBLE-TAP LEFT': 'РЫВОК / ДВОЙНОЕ КАСАНИЕ СЛЕВА',
    'SWAP / TAP THE BAR': 'СМЕНА / КАСАНИЕ ПАНЕЛИ', 'TAP WAVE TIMER': 'КАСАНИЕ ТАЙМЕРА ВОЛНЫ', 'II BUTTON': 'КНОПКА II',
    'LEFT STICK': 'ЛЕВЫЙ СТИК', 'RIGHT STICK': 'ПРАВЫЙ СТИК', 'Y / D-PAD': 'Y / КРЕСТОВИНА',
    'MOUSE': 'МЫШЬ', 'AIM': 'ПРИЦЕЛ', 'CLICK': 'ЛКМ', 'FIRE': 'ОГОНЬ', 'SPACE / RMB': 'ПРОБЕЛ / ПКМ', '1-0 / WHEEL / Q': '1-0 / КОЛЕСО / Q',
    'WEAPONS': 'ОРУЖИЕ', 'EARLY CALL': 'ДОСРОЧНЫЙ ВЫЗОВ', 'PAUSE / OPTIONS': 'ПАУЗА / НАСТРОЙКИ', 'MUSIC / NEXT TRACK': 'МУЗЫКА / СЛЕД. ТРЕК',
    'STARTING KIT  ·  {0} / {1}  ·  {2} UNLOCKED': 'СТАРТОВЫЙ КОМПЛЕКТ  ·  {0} / {1}  ·  ОТКРЫТО: {2}',
    'LOCKED  ·  {0}': 'ЗАКРЫТ  ·  {0}',
    'TAP  <  >  TO CHANGE KIT': 'КАСАЙСЯ  <  >  ДЛЯ СМЕНЫ КОМПЛЕКТА', 'D-PAD / BUMPERS TO CHANGE KIT': 'КРЕСТОВИНА / БАМПЕРЫ - СМЕНА КОМПЛЕКТА',
    'A / D OR ARROWS TO CHANGE KIT': 'A / D ИЛИ СТРЕЛКИ - СМЕНА КОМПЛЕКТА',
    '- TOP 10 -': '- ТОП 10 -', 'W{0}': 'ВОЛНА {0}',

    // ---- pause
    'YOUR BUILD': 'ТВОЯ СБОРКА', 'NOTHING YET - GRAB SUPPLY DROPS': 'ПОКА ПУСТО - СОБИРАЙ ПРИПАСЫ',
    'PAUSED': 'ПАУЗА', 'TAP OUTSIDE TO RESUME': 'КОСНИСЬ ВНЕ МЕНЮ, ЧТОБЫ ПРОДОЛЖИТЬ', 'START / B TO RESUME': 'START / B - ПРОДОЛЖИТЬ', 'ESC TO RESUME': 'ESC - ПРОДОЛЖИТЬ',
    'LEFT THUMB MOVE   ·   RIGHT THUMB AIM + FIRE   ·   DASH BUTTON OR DOUBLE-TAP LEFT': 'ЛЕВЫЙ ПАЛЕЦ - ДВИЖЕНИЕ   ·   ПРАВЫЙ - ПРИЦЕЛ И ОГОНЬ   ·   РЫВОК: КНОПКА ИЛИ ДВОЙНОЕ КАСАНИЕ',
    'SWAP OR TAP THE WEAPON BAR   ·   TAP THE WAVE TIMER TO CALL EARLY': 'СМЕНА ОРУЖИЯ: КНОПКА ИЛИ ПАНЕЛЬ   ·   КАСАНИЕ ТАЙМЕРА - ДОСРОЧНЫЙ ВЫЗОВ',
    'WASD MOVE   ·   MOUSE AIM   ·   CLICK FIRE   ·   SPACE DASH   ·   F EARLY CALL': 'WASD ДВИЖЕНИЕ   ·   МЫШЬ ПРИЦЕЛ   ·   ЛКМ ОГОНЬ   ·   ПРОБЕЛ РЫВОК   ·   F ДОСРОЧНЫЙ ВЫЗОВ',
    '1-0 / WHEEL / Q WEAPONS   ·   M MUSIC   ·   N NEXT TRACK': '1-0 / КОЛЕСО / Q ОРУЖИЕ   ·   M МУЗЫКА   ·   N СЛЕД. ТРЕК',

    // ---- run report
    'SENTRY DRONES': 'ДРОНЫ', 'PERKS': 'ПЕРКИ', 'POWER-UPS': 'УСИЛЕНИЯ', 'ALIEN BLASTS': 'ВЗРЫВЫ ЧУЖИХ', 'BARRELS': 'БОЧКИ', 'TURRETS': 'ТУРЕЛИ', 'OTHER': 'ПРОЧЕЕ',
    'WATCH THE WIND-UP AND DASH THROUGH ITS ATTACKS': 'СЛЕДИ ЗА ЗАМАХОМ И УХОДИ РЫВКОМ СКВОЗЬ АТАКИ',
    'CRAWLERS COME IN NUMBERS - KEEP MOVING, DASH THROUGH GAPS': 'ПОЛЗУНЫ БЕРУТ ЧИСЛОМ - НЕ СТОЙ, ПРОРЫВАЙСЯ В БРЕШИ',
    'LEAPERS CROUCH BEFORE THEY POUNCE - SIDESTEP THEN': 'ПРЫГУНЫ ПРИСЕДАЮТ ПЕРЕД ПРЫЖКОМ - ТУТ И УХОДИ В СТОРОНУ',
    'SPITTERS AIM WHERE YOU ARE HEADING - CHANGE DIRECTION': 'ПЛЕВУНЫ ЦЕЛЯТ ТУДА, КУДА ТЫ ИДЁШЬ - МЕНЯЙ НАПРАВЛЕНИЕ',
    'BRUTES CHARGE IN A STRAIGHT LINE - DASH SIDEWAYS': 'ГРОМИЛЫ ТАРАНЯТ ПО ПРЯМОЙ - УХОДИ РЫВКОМ ВБОК',
    'POP BOOMERS AT RANGE, IDEALLY INSIDE A CROWD': 'ВЗРЫВАЙ ВЗРЫВУНОВ ИЗДАЛЕКА, ЛУЧШЕ В ТОЛПЕ',
    'PHANTOMS SHOW UP IN YOUR FLASHLIGHT - SWEEP YOUR AIM': 'ФАНТОМЫ ВИДНЫ В СВЕТЕ ФОНАРЯ - ВОДИ ПРИЦЕЛОМ',
    'BURROWERS SURFACE UNDER YOU - WATCH THE DIRT TRAIL, KEEP MOVING': 'ЗЕМЛЕРОИ ВЫНЫРИВАЮТ ПОД ТОБОЙ - СЛЕДИ ЗА ГРУНТОМ, НЕ СТОЙ',
    'WARDENS TURN SLOWLY - CIRCLE TO THEIR BACK': 'СТРАЖИ МЕДЛЕННО ПОВОРАЧИВАЮТСЯ - ЗАХОДИ СО СПИНЫ',
    'KILL HATCHERS FAST - EACH ONE BURSTS INTO MITES': 'УБИВАЙ ИНКУБАТОРЫ БЫСТРО - ИЗ НИХ ВЫСЫПАЮТ КЛЕЩИ',
    'STINGERS FLY OVER COVER - STRAFE INSTEAD OF HIDING': 'ЖАЛОНОСЫ ЛЕТАЮТ НАД УКРЫТИЯМИ - МАНЁВРИРУЙ, А НЕ ПРЯЧЬСЯ',
    'MITES DIE TO ANY SPLASH - ROCKETS AND FLAMES CLEAR THEM': 'КЛЕЩЕЙ УБИВАЕТ ЛЮБОЙ ВЗРЫВ - РАКЕТЫ И ОГОНЬ ИХ СМЕТАЮТ',
    'SHOOT EGGS BEFORE THEY HATCH': 'РАССТРЕЛИВАЙ ЯЙЦА, ПОКА НЕ ВЫЛУПИЛИСЬ',
    'STAY OUT OF THE PUDDLES - THEY IGNORE DASH I-FRAMES': 'ОБХОДИ ЛУЖИ - РЫВОК ОТ НИХ НЕ СПАСАЕТ',
    'PLASMA POOLS BURN FAST - NEVER FIGHT INSIDE ONE': 'ПЛАЗМА ЖЖЁТ БЫСТРО - НЕ СРАЖАЙСЯ В НЕЙ',
    'BARRELS HURT YOU TOO - SET THEM OFF FROM RANGE': 'БОЧКИ РАНЯТ И ТЕБЯ - ВЗРЫВАЙ ИХ ИЗДАЛЕКА',
    'VENT FLARES LAND WHERE YOU ARE HEADING - CHANGE DIRECTION': 'ПЛАМЯ ИЗ ЛЮКОВ БЬЁТ ТУДА, КУДА ТЫ ИДЁШЬ - МЕНЯЙ НАПРАВЛЕНИЕ',
    'DASH THROUGH THE CORE FLARE - DASH I-FRAMES IGNORE IT': 'ПРОХОДИ ВСПЫШКУ ЯДРА РЫВКОМ - ВО ВРЕМЯ РЫВКА ОНА НЕ РАНИТ',
    'VOLATILE ELITES BLOW UP AFTER DEATH - LEAVE THE RING': 'НЕСТАБИЛЬНАЯ ЭЛИТА ВЗРЫВАЕТСЯ ПОСЛЕ СМЕРТИ - ВЫЙДИ ИЗ КРУГА',
    'TIME': 'ВРЕМЯ', 'KILLS': 'УБИЙСТВА', 'BEST COMBO': 'МАКС. КОМБО', 'DODGES': 'УВОРОТЫ',
    'ELITES': 'ЭЛИТА', 'BOSSES': 'БОССЫ', 'DMG TAKEN': 'ПОЛУЧ. УРОН', 'EARLY CALLS': 'ДОСР. ВЫЗОВЫ',
    'RUN REPORT': 'ОТЧЁТ О ЗАБЕГЕ',
    '{0} TWIST SURVIVED': 'ОСОБЫХ ВОЛН ПЕРЕЖИТО: {0}', '{0} TWISTS SURVIVED': 'ОСОБЫХ ВОЛН ПЕРЕЖИТО: {0}', '  ·  {0} BOUNTY': '  ·  МЕЧЕНЫХ: {0}',
    'KIT UNLOCKED: {0}': 'ОТКРЫТ КОМПЛЕКТ: {0}',
    'DAMAGE DEALT': 'НАНЕСЁННЫЙ УРОН', 'KILLED BY': 'ПРИЧИНА СМЕРТИ',

    // ---- game over
    'YOU DIED': 'ТЫ ПОГИБ',
    'WAVE {0}   SCORE {1}   KILLS {2}': 'ВОЛНА {0}   СЧЁТ {1}   УБИЙСТВ {2}',
    'NEW HIGH SCORE!': 'НОВЫЙ РЕКОРД!', 'ENTER YOUR INITIALS': 'ВВЕДИ ИНИЦИАЛЫ (ЛАТИНИЦЕЙ)',
    'TAP THE ARROWS TO PICK  -  OK TO CONFIRM': 'ВЫБИРАЙ СТРЕЛКАМИ  -  OK ДЛЯ ПОДТВЕРЖДЕНИЯ',
    'D-PAD TO PICK  -  A TO CONFIRM': 'КРЕСТОВИНА - ВЫБОР  -  A - ПОДТВЕРДИТЬ',
    'TYPE OR USE ARROWS  -  ENTER TO CONFIRM': 'ПЕЧАТАЙ ИЛИ ЖМИ СТРЕЛКИ  -  ENTER ДЛЯ ПОДТВЕРЖДЕНИЯ',
    'NEW PERSONAL BEST!': 'НОВЫЙ ЛИЧНЫЙ РЕКОРД!',
    'NEXT KIT:  {0}': 'СЛЕДУЮЩИЙ КОМПЛЕКТ:  {0}', '  (LOCKED)': '  (ЗАКРЫТ)',
    'TAP TO REDEPLOY': 'КОСНИСЬ - СНОВА В БОЙ', 'PRESS A TO REDEPLOY': 'НАЖМИ A - СНОВА В БОЙ', 'CLICK TO REDEPLOY': 'КЛИКНИ - СНОВА В БОЙ',
  };

  const DICTS = { ru: RU };
  const LANGS = ['en', 'ru'];
  let lang = 'en', dict = null;

  // the browser's first preferred language decides the default; ?lang=xx overrides it
  function detect() {
    const q = /[?&]lang=([a-z]{2})/i.exec(location.search);
    if (q && LANGS.includes(q[1].toLowerCase())) return q[1].toLowerCase();
    const pref = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return /^ru\b/i.test(pref) ? 'ru' : 'en';
  }
  const fromUrl = () => /[?&]lang=(en|ru)\b/i.test(location.search);

  function t(s, ...args) {
    if (typeof s !== 'string') return s;
    let r = dict && Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s;
    if (args.length) r = r.replace(/\{(\d)\}/g, (m, i) => (args[i] === undefined ? m : args[i]));
    return r;
  }

  function set(l) {
    lang = LANGS.includes(l) ? l : 'en';
    dict = DICTS[lang] || null;
    document.documentElement.lang = lang;
    // static page text (boot console, rotate screen)
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  }

  window.I18N = { t, set, detect, fromUrl, LANGS, get lang() { return lang; } };
  set(detect());
})();
