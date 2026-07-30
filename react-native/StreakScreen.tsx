/**
 * StreakScreen — екран нагороди в кінці дня (Relatio redesign)
 *
 * Стек: react-native-reanimated 3 + react-native-svg + expo-haptics
 * Дизайн: Figma "Streak / Redesign / Dark / E — Opal wow" 18360:92031
 * Спека руху: streak-screen-motion.html (скраб по таймлайну, ті самі числа)
 *
 * ПРИНЦИПИ, які не варто «оптимізувати»:
 * 1. Рухаються тільки transform і opacity. Ніяких анімацій width/height/top.
 * 2. Вогник росте З ОСНОВИ (scaleY від низу), а не від центру — це «займається».
 * 3. Спершу форма, потім світло: купол і глоу вступають після силуету.
 * 4. Число — частина героя: «2» просто проявляється, а зміна на «3» стиснута
 *    в ОДИН біт разом зі спалахом і сплеском іскор.
 * 5. Шкала росте від першого дня до останнього, і саме іскра запалює сьогодні.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, useColorScheme, AccessibilityInfo, Platform } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withRepeat, withSequence,
  Easing, interpolate, Extrapolation, cancelAnimation, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Defs, LinearGradient, RadialGradient, Stop, Ellipse, G, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

/* ──────────────────────────────────────────────────────────────────────────
   ТОКЕНИ
   Значення нижче — резолвнуті з Figma (колекція Color/Semantic).
   У проді читати з теми DS, а не хардкодити.
   ────────────────────────────────────────────────────────────────────────── */
const TOKENS = {
  dark: {
    bgDefault: '#0c0d11',      // bg/default
    textDefault: '#f9fafd',    // text/default
    textSecondary: '#c2c3cb',  // text/secondary
    borderStrong: '#4f5059',   // border/strong
    warningBold: '#ffcc00',    // bg/warning-bold — трек серії, іскри, купол
    brandSubtle: '#393292',    // border/brand-subtle — холодна підошва
    ctaBg: '#f9fafd',
    ctaLabel: '#0c0d11',
  },
  light: {
    bgDefault: '#f9fafd',
    textDefault: '#0c0d11',
    textSecondary: '#4f5059',
    borderStrong: '#dddee4',
    warningBold: '#ffcc00',
    brandSubtle: '#ebedff',
    ctaBg: '#0c0d11',
    ctaLabel: '#f9fafd',
  },
};

const SPACE = { s2: 2, s4: 4, s8: 8, s12: 12, s16: 16, s20: 20, s24: 24, s32: 32, s48: 48, s64: 64 };
const OPACITY = { o10: 0.1, o20: 0.2, o30: 0.3, o40: 0.4, o50: 0.5, o70: 0.7 };

/* ──────────────────────────────────────────────────────────────────────────
   ТАЙМЛАЙН (мс) — 1:1 зі streak-screen-motion.html
   ────────────────────────────────────────────────────────────────────────── */
const T = {
  strike: 0,          strikeDur: 110,
  flash: 25,          flashDur: 90,
  strikeSparks: 50,   strikeSparksDur: 380,  strikeSparksStagger: 28,
  flame: 250,         flameDur: 900,
  heroGlow: 580,      heroGlowDur: 900,
  dome: 560,          domeDur: 1100,
  base: 700,          baseDur: 800,
  embers: 750,
  digitIn: 520,       digitInDur: 700,
  beat: 1900,
  beatFlameDur: 360,  beatGlowDur: 460,  burstDur: 600, burstStagger: 16,
  digitOutDur: 300,   digitNewDelay: 30, digitNewDur: 340,
  caps: 2400,         textDur: 340,
  praiseTitle: 2500,  praiseBody: 2580,  praiseDur: 380,
  week: 2750,         weekStagger: 55,   weekDur: 320,
  track: 2950,        trackDur: 600,
  runners: [2950, 3120, 3270], runnerDur: 620,
  tueFlare: 3280,     flareDur: 440,
  today: 3560,        todayDur: 520,
  cta: 3950,          ctaDur: 350,
  total: 4350,
};

/* Easing з прототипу */
const E = {
  outExpo: Easing.bezier(0.16, 1, 0.3, 1),
  out:     Easing.bezier(0.22, 0.61, 0.36, 1),
  back:    Easing.bezier(0.34, 1.26, 0.64, 1),
  smooth:  Easing.bezier(0.2, 0.8, 0.2, 1),
  fast:    Easing.bezier(0.1, 0.9, 0.2, 1),
  drumOut: Easing.bezier(0.4, 0, 0.7, 1),
  drumIn:  Easing.bezier(0.2, 0.85, 0.3, 1),
};

const SCREEN_W = 440;   // макет: iPhone 17 Pro Max
const HERO = 280;
const CELL = 40, GAP = 16, ROW_W = CELL * 7 + GAP * 6; // 376

type Day = { label: string; lit: boolean };
const DAYS: Day[] = [
  { label: 'Mon', lit: true }, { label: 'Tue', lit: true }, { label: 'Wed', lit: true },
  { label: 'Thu', lit: false }, { label: 'Fri', lit: false },
  { label: 'Sat', lit: false }, { label: 'Sun', lit: false },
];

/* ──────────────────────────────────────────────────────────────────────────
   ВОГНИК — SVG-експорт іконки streak-default (DS, Icons set 4:328)
   ────────────────────────────────────────────────────────────────────────── */
const FLAME_BODY =
  'M9.98535 2.50195C12.5592 3.76754 14.3751 6.35545 14.915 8.61133L15.1152 9.44824L15.7432 8.85938C16.6276 8.0303 16.9341 6.82384 16.9727 5.80664C18.1804 7.04496 19.6914 9.60619 20.1992 12.3857C20.7041 15.1492 20.2123 18.0526 17.4932 20.1543C17.082 20.4593 16.6438 20.7233 16.1855 20.9463C17.1248 19.6035 17.297 18.1813 17.0723 16.9102C16.783 15.275 15.8463 13.9034 15.1279 13.2559L15.0068 13.1699C14.7771 13.0375 14.5122 13.0414 14.2979 13.1533C14.0738 13.2703 13.9004 13.5112 13.9004 13.8037C13.4097 12.8764 12.6061 11.8993 11.5547 11.3555C11.2993 11.2064 11.0161 11.2553 10.8242 11.3896C10.6307 11.5253 10.5029 11.7564 10.5029 12.0107C10.5675 13.5852 9.69589 14.7677 9.01758 15.5469C8.49466 16.1468 7.86108 17.1305 7.69141 18.3018C7.56668 19.1629 7.69986 20.0972 8.26465 21.0186C7.69433 20.7641 7.15872 20.4331 6.67676 20.0293C5.03721 18.6767 4.47204 16.9842 4.50098 15.332C4.53034 13.6612 5.16959 12.0312 5.94727 10.8848C6.40555 10.2176 6.87873 9.59237 7.34375 8.95898C7.80537 8.33023 8.25617 7.69825 8.64746 7.04297C9.38549 5.80691 9.92273 4.47189 9.95605 2.86133V2.51758Z';

function Flame({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="flameGrad" x1="4" y1="12" x2="20.87" y2="12" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFB20C" />
          <Stop offset="0.515" stopColor="#FF710C" />
          <Stop offset="1" stopColor="#FFB20C" />
        </LinearGradient>
      </Defs>
      <Path d={FLAME_BODY} fill="url(#flameGrad)" stroke="#FF9F0C" strokeWidth={0.5} />
    </Svg>
  );
}

/** Купол світла. Градієнт + великий blur у RN дорогі → малюємо SVG-радіалом. */
function GlowDome({ color, w, h }: { color: string; w: number; h: number }) {
  return (
    <Svg width={w} height={h} pointerEvents="none">
      <Defs>
        <RadialGradient id="dome" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={0.85} />
          <Stop offset="0.55" stopColor={color} stopOpacity={0.26} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill="url(#dome)" />
    </Svg>
  );
}

/**
 * Золота цифра. У RN текст не заливається градієнтом напряму, тому число
 * малюється через SVG <Text> із linearGradient. Стопи 1:1 з Figma:
 * Colors/Yellow/500 (#ffd429) → #f5735c, ЗГОРИ ВНИЗ.
 */
function GoldText({ value, size, weight, width, height, tracking = 0 }: {
  value: string; size: number; weight: string; width: number; height: number; tracking?: number;
}) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={'gold' + size} x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#ffd429" />
          <Stop offset="1" stopColor="#f5735c" />
        </LinearGradient>
      </Defs>
      <SvgText
        x={width / 2}
        y={size}
        textAnchor="middle"
        fontFamily={weight}
        fontSize={size}
        letterSpacing={tracking}
        fill={'url(#gold' + size + ')'}
      >
        {value}
      </SvgText>
    </Svg>
  );
}

function SoftGlow({ color, size, opacity = 0.6 }: { color: string; size: number; opacity?: number }) {
  return (
    <Svg width={size} height={size} pointerEvents="none">
      <Defs>
        <RadialGradient id="soft" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={size / 2} cy={size / 2} rx={size / 2} ry={size / 2} fill="url(#soft)" />
    </Svg>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ІСКРИ. Детерміновані: позиція = f(час), тому анімація скрабиться
   й не потребує стану. 14 частинок, різні періоди — не читається як цикл.
   ────────────────────────────────────────────────────────────────────────── */
const rnd = (n: number) => { 'worklet'; const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

const EMBERS = Array.from({ length: 14 }, (_, i) => ({
  birth: i * 160,
  life: 1800 + rnd(i + 9) * 1100,
  x0: SCREEN_W / 2 + (rnd(i + 1) - 0.5) * 90,
  vx: (rnd(i + 2) - 0.5) * 46,
  vy: 96 + rnd(i + 3) * 86,
  sway: 14 + rnd(i + 4) * 22,
  phase: rnd(i + 5) * 6.28,
  size: 2 + Math.round(rnd(i) * 3),
}));

function Ember({ clock, cfg, color }: { clock: Animated.SharedValue<number>; cfg: typeof EMBERS[0]; color: string }) {
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    if (t < T.embers) return { opacity: 0 };
    const raw = (t - T.embers - cfg.birth) % cfg.life;
    const age = ((raw + cfg.life) % cfg.life) / cfg.life;
    const y = -cfg.vy * age * (1.25 - 0.35 * age);
    const x = cfg.vx * age + Math.sin(cfg.phase + age * 4.2) * cfg.sway * age;
    const op = (age < 0.18 ? age / 0.18 : 1 - (age - 0.18) / 0.82) * 0.9;
    return { opacity: op, transform: [{ translateX: x }, { translateY: y }, { scale: 1 - 0.55 * age }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: cfg.x0, top: 400, width: cfg.size, height: cfg.size,
          borderRadius: cfg.size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ЕКРАН
   ────────────────────────────────────────────────────────────────────────── */
export type StreakScreenProps = {
  /** нове значення стріку (те, що буде після цього вечора) */
  streak: number;
  /** індекс сьогоднішнього дня в тижні, 0 = Mon */
  todayIndex?: number;
  onContinue?: () => void;
  /** вимкнути хаптику (напр. у сторібуку) */
  haptics?: boolean;
};

export default function StreakScreen({
  streak = 3,
  todayIndex = 2,
  onContinue,
  haptics = true,
}: StreakScreenProps) {
  const scheme = useColorScheme();
  const c = TOKENS[scheme === 'light' ? 'light' : 'dark'];
  const isLight = scheme === 'light';

  /** єдиний годинник сцени — усі шари читають його, тож нічого не розсинхронізується */
  const clock = useSharedValue(0);
  const reduce = useSharedValue(0);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!mounted) return;
      reduce.value = on ? 1 : 0;
      if (on) {
        // Reduce motion: без чирка, іскор і барабана — тільки поява за 200 мс
        clock.value = withTiming(T.total, { duration: 200, easing: Easing.linear });
      } else {
        clock.value = withTiming(T.total, { duration: T.total, easing: Easing.linear });
        if (haptics) {
          scheduleHaptics();
        }
      }
    });
    return () => { mounted = false; cancelAnimation(clock); };
  }, []);

  function scheduleHaptics() {
    // 3 точки: чирк · вогник узявся · шкала дійшла до сьогодні
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), T.strike);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 720);
    setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), T.today);
  }

  /** прогрес окремого треку: 0..1 з easing */
  const seg = (start: number, dur: number, ease: (t: number) => number) => {
    'worklet';
    const p = Math.max(0, Math.min(1, (clock.value - start) / dur));
    return ease(p);
  };

  /* ── чирк ── */
  const strikeStyle = useAnimatedStyle(() => {
    const inP = seg(T.strike, T.strikeDur, E.fast);
    const outP = seg(T.strike + T.strikeDur, 220, E.out);
    return { opacity: reduce.value ? 0 : 1 - outP, transform: [{ scaleX: inP }, { rotate: '-18deg' }] };
  });
  const flashStyle = useAnimatedStyle(() => {
    const inP = seg(T.flash, T.flashDur, E.fast);
    const outP = seg(T.flash + T.flashDur, 280, E.out);
    return { opacity: reduce.value ? 0 : inP * (1 - outP), transform: [{ scale: 0.3 + 0.9 * inP + 0.9 * outP }] };
  });

  /* ── вогник: росте з основи + спалах у біті ── */
  const flameStyle = useAnimatedStyle(() => {
    const g = seg(T.flame, T.flameDur, E.outExpo);
    const beat = seg(T.beat, T.beatFlameDur, (t) => t);
    const pulse = beat > 0 && beat < 1 ? Math.sin(Math.PI * beat) : 0;
    const sy = (0.12 + 0.88 * g) * (1 + 0.09 * pulse);
    const sx = (0.55 + 0.45 * g) * (1 + 0.09 * Math.sin(Math.PI * Math.min(1, (clock.value - T.flame) / T.flameDur * 1.15))) * (1 + 0.05 * pulse);
    return {
      opacity: Math.min(1, ((clock.value - T.flame) / T.flameDur) * 4),
      transform: [{ scaleX: sx }, { scaleY: sy }],
    };
  });

  /* ── світло: купол, глоу вогника, підошва ── */
  const domeStyle = useAnimatedStyle(() => {
    const p = seg(T.dome, T.domeDur, E.outExpo);
    const beat = seg(T.beat, T.beatGlowDur, (t) => t);
    const pulse = beat > 0 && beat < 1 ? Math.sin(Math.PI * beat) : 0;
    return { opacity: OPACITY.o30 * p + 0.2 * pulse, transform: [{ scale: 0.72 + 0.28 * p }] };
  });
  const heroGlowStyle = useAnimatedStyle(() => {
    const p = seg(T.heroGlow, T.heroGlowDur, E.outExpo);
    const beat = seg(T.beat, T.beatGlowDur, (t) => t);
    const pulse = beat > 0 && beat < 1 ? Math.sin(Math.PI * beat) : 0;
    return { opacity: OPACITY.o30 * p + 0.28 * pulse, transform: [{ scale: 0.7 + 0.3 * p + 0.08 * pulse }] };
  });
  const baseStyle = useAnimatedStyle(() => ({ opacity: OPACITY.o40 * seg(T.base, T.baseDur, E.outExpo) }));

  /* ── число: барабан. Нова цифра ЗГОРИ, стара ВНИЗ, обидві дрібнішають ── */
  const oldDigitStyle = useAnimatedStyle(() => {
    const inP = seg(T.digitIn, T.digitInDur, E.out);
    const outP = seg(T.beat, T.digitOutDur, E.drumOut);
    if (outP <= 0) return { opacity: inP, transform: [{ translateY: 0 }, { scale: 1 }] };
    return { opacity: 1 - outP, transform: [{ translateY: 58 * outP }, { scale: 1 - 0.45 * outP }] };
  });
  const newDigitStyle = useAnimatedStyle(() => {
    const p = seg(T.beat + T.digitNewDelay, T.digitNewDur, E.drumIn);
    return { opacity: 0.15 + 0.85 * p, transform: [{ translateY: -58 * (1 - p) }, { scale: 0.55 + 0.45 * p }] };
  });

  /* ── тексти знизу: усі приходять зсувом по Y ── */
  const capsStyle = useAnimatedStyle(() => {
    const p = seg(T.caps, T.textDur, E.out);
    return { opacity: p, transform: [{ translateY: 22 * (1 - p) }] };
  });
  const titleStyle = useAnimatedStyle(() => {
    const p = seg(T.praiseTitle, T.praiseDur, E.out);
    return { opacity: p, transform: [{ translateY: 24 * (1 - p) }] };
  });
  const bodyStyle = useAnimatedStyle(() => {
    const p = seg(T.praiseBody, T.praiseDur, E.out);
    return { opacity: p, transform: [{ translateY: 24 * (1 - p) }] };
  });
  const ctaStyle = useAnimatedStyle(() => {
    const p = seg(T.cta, T.ctaDur, E.out);
    return { opacity: p, transform: [{ translateY: 16 * (1 - p) }] };
  });

  /* ── шкала серії ── */
  const trackStyle = useAnimatedStyle(() => {
    const p = seg(T.track, T.trackDur, E.smooth);
    return { opacity: OPACITY.o10 * p, transform: [{ scaleX: p }] };
  });
  const trackGlowStyle = useAnimatedStyle(() => {
    const p = seg(T.track, T.trackDur, E.smooth);
    return { opacity: OPACITY.o30 * p, transform: [{ scaleX: p }] };
  });

  return (
    <View style={[styles.screen, { backgroundColor: c.bgDefault }]}>
      {/* СВІТЛО — під усім */}
      <Animated.View style={[styles.dome, domeStyle]} pointerEvents="none">
        <GlowDome color={c.warningBold} w={640} h={500} />
      </Animated.View>

      <Animated.View style={[styles.base, baseStyle]} pointerEvents="none">
        <SoftGlow color={c.brandSubtle} size={124} opacity={0.5} />
      </Animated.View>

      <Animated.View style={[styles.heroGlow, heroGlowStyle]} pointerEvents="none">
        <SoftGlow color={c.warningBold} size={240} />
      </Animated.View>

      {/* ЧИРК */}
      <Animated.View style={[styles.strike, strikeStyle, { backgroundColor: '#fff8e0' }]} pointerEvents="none" />
      <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none">
        <SoftGlow color="#fffdf5" size={28} opacity={0.9} />
      </Animated.View>

      {/* ГЕРОЙ */}
      <Animated.View style={[styles.hero, flameStyle]}>
        <Flame size={HERO} />
      </Animated.View>

      {/* ІСКРИ — тільки на темній: на світлому читаються як бруд */}
      {!isLight && EMBERS.map((cfg, i) => <Ember key={i} clock={clock} cfg={cfg} color={c.warningBold} />)}

      {/* ЧИСЛО. Вікно з overflow:hidden — без кліпу барабан читається як зсув */}
      <View style={styles.numWindow}>
        <Animated.View style={[styles.digit, oldDigitStyle]}>
          <GoldText value={String(streak - 1)} size={56} weight="Poppins-Bold" width={SCREEN_W} height={64} />
        </Animated.View>
        <Animated.View style={[styles.digit, newDigitStyle]}>
          <GoldText value={String(streak)} size={56} weight="Poppins-Bold" width={SCREEN_W} height={64} />
        </Animated.View>
      </View>

      <Animated.View style={[styles.caps, capsStyle]}>
        <GoldText value="DAY STREAK" size={12} weight="Poppins-Medium" width={SCREEN_W} height={18} tracking={0.96} />
      </Animated.View>
      <Animated.Text style={[styles.title, { color: c.textDefault }, titleStyle]}>You're on fire</Animated.Text>
      <Animated.Text style={[styles.body, { color: c.textSecondary }, bodyStyle]}>
        Come back tomorrow to keep it alive.
      </Animated.Text>

      {/* ТИЖДЕНЬ */}
      <View style={styles.week}>
        <Animated.View
          style={[styles.trackGlow, trackGlowStyle]}
          pointerEvents="none"
        >
          <SoftGlow color={c.warningBold} size={172} opacity={0.5} />
        </Animated.View>
        <Animated.View style={[styles.track, { backgroundColor: c.warningBold }, trackStyle]} pointerEvents="none" />
        {DAYS.map((d, i) => (
          <WeekCell key={d.label} day={d} index={i} isToday={i === todayIndex} clock={clock} c={c} />
        ))}
        {[0, 1, 2].map((i) => (
          <Runner key={i} index={i} clock={clock} color={c.warningBold} />
        ))}
      </View>

      <Animated.View style={[styles.ctaWrap, ctaStyle]}>
        <Pressable
          onPress={onContinue}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, { backgroundColor: c.ctaBg, opacity: pressed ? 0.9 : 1 }]}
        >
          <Text style={[styles.ctaLabel, { color: c.ctaLabel }]}>I'm committed</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/* ── комірка дня ─────────────────────────────────────────────────────────── */
function WeekCell({ day, index, isToday, clock, c }: {
  day: Day; index: number; isToday: boolean;
  clock: Animated.SharedValue<number>; c: typeof TOKENS.dark;
}) {
  const appear = useAnimatedStyle(() => {
    const start = T.week + index * T.weekStagger;
    const p = Math.max(0, Math.min(1, (clock.value - start) / T.weekDur));
    const e = E.out(p);
    return { opacity: e, transform: [{ translateY: 10 * (1 - e) }] };
  });

  /** сьогоднішній вогник СТАРТУЄ ПРИХОВАНИМ — його запалює іскра, що доїхала */
  const mark = useAnimatedStyle(() => {
    if (isToday) {
      const p = Math.max(0, Math.min(1, (clock.value - T.today) / T.todayDur));
      if (p <= 0) return { opacity: 0, transform: [{ scale: 0 }] };
      const g = E.outExpo(p);
      return {
        opacity: 1,
        transform: [{ scaleX: (0.6 + 0.4 * g) * (1 + 0.12 * Math.sin(Math.PI * Math.min(1, p * 1.15))) },
                    { scaleY: 0.15 + 0.85 * g }],
      };
    }
    // Tue дає флер, коли крізь нього пробігає іскра
    if (index === 1) {
      const p = Math.max(0, Math.min(1, (clock.value - T.tueFlare) / 340));
      return { opacity: 1, transform: [{ scale: 1 + 0.12 * Math.sin(Math.PI * p) }] };
    }
    return { opacity: 1, transform: [{ scale: 1 }] };
  });

  const flare = useAnimatedStyle(() => {
    const start = isToday ? T.today : T.tueFlare;
    const dur = isToday ? 700 : T.flareDur;
    const peak = isToday ? 0.7 : 0.55;
    const p = Math.max(0, Math.min(1, (clock.value - start) / dur));
    if (p <= 0 || (!isToday && index !== 1)) return { opacity: 0 };
    return { opacity: p < 0.3 ? (p / 0.3) * peak : peak - ((p - 0.3) / 0.7) * peak * 0.6 };
  });

  return (
    <Animated.View style={[styles.cell, { left: index * (CELL + GAP) }, appear]}>
      <Animated.View style={[styles.cellFlare, flare]} pointerEvents="none">
        <SoftGlow color={c.warningBold} size={56} opacity={0.75} />
      </Animated.View>
      {day.lit ? (
        <Animated.View style={[styles.mark, mark]}><Flame size={24} /></Animated.View>
      ) : (
        <View style={[styles.ring, { borderColor: c.borderStrong }]} />
      )}
      <Text style={[styles.cellLabel, { color: day.lit ? c.textDefault : c.textSecondary,
                                        fontWeight: day.lit ? '600' : '500' }]}>
        {day.label}
      </Text>
    </Animated.View>
  );
}

/* ── іскра-бігунок по шкалі ──────────────────────────────────────────────── */
function Runner({ index, clock, color }: { index: number; clock: Animated.SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const start = T.runners[index];
    const p = Math.max(0, Math.min(1, (clock.value - start) / T.runnerDur));
    const e = E.out(p);
    if (p <= 0 || p >= 1) return { opacity: 0 };
    const op = p < 0.12 ? p / 0.12 : p > 0.82 ? (1 - p) / 0.18 : 1;
    return { opacity: op, transform: [{ translateX: 8 + 132 * e }, { scale: 1.15 - 0.4 * e }] };
  });
  return (
    <Animated.View style={[styles.runner, style]} pointerEvents="none">
      <SoftGlow color={color} size={8} opacity={0.95} />
    </Animated.View>
  );
}

/* ── геометрія 1:1 з макета ──────────────────────────────────────────────── */
const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },

  dome: { position: 'absolute', left: -100, top: -40 },
  base: { position: 'absolute', left: 158, top: 486, height: 24, overflow: 'hidden' },
  heroGlow: { position: 'absolute', left: 100, top: 280 },
  hero: { position: 'absolute', left: 80, top: 240, width: HERO, height: HERO },

  strike: { position: 'absolute', left: 196, top: 472, width: 48, height: 2, borderRadius: 2 },
  flash: { position: 'absolute', left: 206, top: 456 },

  numWindow: { position: 'absolute', left: 0, top: 537, width: SCREEN_W, height: 64, overflow: 'hidden' },
  digit: { position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: 64 },

  caps: { position: 'absolute', left: 0, top: 605, width: SCREEN_W, height: 18 },
  title: { position: 'absolute', left: SPACE.s32, top: 687, width: 376, textAlign: 'center',
           fontFamily: 'Poppins-SemiBold', fontSize: 16, lineHeight: 24 },
  body: { position: 'absolute', left: SPACE.s32, top: 715, width: 376, textAlign: 'center',
          fontFamily: 'Poppins-Regular', fontSize: 14, lineHeight: 21 },

  week: { position: 'absolute', left: SPACE.s32, top: 770, width: ROW_W, height: 54 },
  track: { position: 'absolute', left: 0, top: -2, width: 152, height: 28, borderRadius: 14,
           transform: [{ scaleX: 0 }] },
  trackGlow: { position: 'absolute', left: -10, top: -22, width: 172, height: 52 },
  runner: { position: 'absolute', top: 6, left: 0, width: 8, height: 8 },

  cell: { position: 'absolute', top: 0, width: CELL, height: 54, alignItems: 'center' },
  cellFlare: { position: 'absolute', left: -8, top: -16 },
  mark: { width: 24, height: 24 },
  ring: { position: 'absolute', left: 9, top: 1, width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
  cellLabel: { position: 'absolute', top: 28, width: CELL, textAlign: 'center',
               fontFamily: 'Poppins-Medium', fontSize: 14, lineHeight: 21 },

  ctaWrap: { position: 'absolute', left: SPACE.s16, top: 868, width: 408 },
  cta: { height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ctaLabel: { fontFamily: 'Poppins-SemiBold', fontSize: 16 },
});

/* ──────────────────────────────────────────────────────────────────────────
   ВІДКРИТІ ПИТАННЯ ДО ІНТЕГРАЦІЇ
   1. Два/три розряди числа: зараз одна цифра. Треба вирішити, чи крутяться
      всі розряди, чи лише останній, і як росте ширина вікна.
   2. Купол і глоу тут — SVG-радіали. Якщо на слабких Android просідає fps,
      альтернатива: один статичний PNG@3x на купол (але тоді він не
      перефарбується під тему — краще лишити SVG).
   3. Idle-луп вогника (wobble ±1.6°, 3 s) не в цьому файлі: або Lottie
      streak-flame-animation.json, або withRepeat на цьому ж Animated.View.
   4. Пресет на щодень (~2 s) поки не зроблений — чекає рішення дизайну.
   ────────────────────────────────────────────────────────────────────────── */
