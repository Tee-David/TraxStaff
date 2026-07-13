import { motion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, type CSSProperties } from "react";
import "./Counter.css";

function Number({ mv, number, height }: { mv: MotionValue<number>; number: number; height: number }) {
  const y = useTransform(mv, (latest: number) => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * height;
    if (offset > 5) memo -= 10 * height;
    return memo;
  });
  return (
    <motion.span className="counter-number" style={{ y }}>
      {number}
    </motion.span>
  );
}

function getValueRoundedToPlace(value: number, place: number): number {
  return Math.floor(value / place);
}

function Digit({
  place,
  value,
  height,
  digitStyle,
}: {
  place: number;
  value: number;
  height: number;
  digitStyle?: CSSProperties;
}) {
  const valueRoundedToPlace = getValueRoundedToPlace(value, place);
  const animatedValue = useSpring(valueRoundedToPlace, { stiffness: 220, damping: 26 });

  useEffect(() => {
    animatedValue.set(valueRoundedToPlace);
  }, [animatedValue, valueRoundedToPlace]);

  return (
    <span className="counter-digit" style={{ height, ...digitStyle }}>
      {Array.from({ length: 10 }, (_, i) => (
        <Number key={i} mv={animatedValue} number={i} height={height} />
      ))}
    </span>
  );
}

export default function Counter({
  value,
  fontSize = 48,
  padding = 0,
  places = [10, 1],
  gap = 2,
  textColor = "inherit",
  fontWeight = 700,
  digitStyle,
}: {
  value: number;
  fontSize?: number;
  padding?: number;
  places?: number[];
  gap?: number;
  textColor?: string;
  fontWeight?: number | string;
  digitStyle?: CSSProperties;
}) {
  const height = fontSize + padding;
  return (
    <span
      className="counter-counter"
      style={{ fontSize, gap, color: textColor, fontWeight, lineHeight: 1 }}
    >
      {places.map((place) => (
        <Digit key={place} place={place} value={value} height={height} digitStyle={digitStyle} />
      ))}
    </span>
  );
}
