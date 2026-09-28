// A normalized drawing space keeps the entire semicircle inside every viewport.
// These are stable presentation proportions, not deck or business rules.
// Match the approved card-table proportions; rendering and hit testing share this space.
export const FAN = {
  width: 1000,
  height: 640,
  cx: 500,
  cy: 510,
  radius: 330,
  cardWidth: 160,
  cardHeight: 260,
  lift: 30,
};
export interface FanPose {
  x: number;
  y: number;
  angle: number;
}

// Local presentation falloffs leave the rest of the fan still while browsing.
const NEIGHBORHOOD = { spreadCards: 8, spreadDegrees: 8, liftCards: 4 };

export function fanPoses(count: number, focus: number | null, active: number | null): FanPose[] {
  const step = count > 1 ? 180 / (count - 1) : 0;
  return Array.from({ length: count }, (_, index) => {
    let angle = count > 1 ? -90 + step * index : 0;
    if (focus !== null && index !== focus) {
      const direction = index < focus ? -1 : 1;
      const length = direction < 0 ? focus : count - 1 - focus;
      const reach = Math.min(NEIGHBORHOOD.spreadCards, length);
      const distance = Math.abs(index - focus);
      if (distance < reach) {
        // Bound the falloff slope below one card interval, preserving order even
        // near an endpoint. The offset reaches zero before moving distant cards.
        const amplitude = Math.min(NEIGHBORHOOD.spreadDegrees, (step * reach) / 2);
        angle += direction * amplitude * (1 - distance / reach) ** 2;
      }
    }
    const lift =
      active === null
        ? 0
        : FAN.lift * Math.max(0, 1 - Math.abs(index - active) / NEIGHBORHOOD.liftCards) ** 2;
    const radians = (angle * Math.PI) / 180;
    return {
      x: FAN.cx + (FAN.radius + lift) * Math.sin(radians),
      y: FAN.cy - (FAN.radius + lift) * Math.cos(radians),
      angle,
    };
  });
}

export function hitFan(
  x: number,
  y: number,
  poses: FanPose[],
  selected: number[],
  angleOffset = 0,
): number | null {
  const distance = Math.hypot(x - FAN.cx, FAN.cy - y);
  if (
    y > FAN.cy + FAN.cardWidth / 2 ||
    distance < FAN.radius - FAN.cardHeight / 2 ||
    distance > FAN.radius + FAN.cardHeight / 2 + FAN.lift
  )
    return null;
  const angle = (Math.atan2(x - FAN.cx, FAN.cy - y) * 180) / Math.PI + angleOffset;
  let closest: number | null = null;
  for (let i = 0; i < poses.length; i++) {
    if (
      !selected.includes(i) &&
      (closest === null ||
        Math.abs(poses[i].angle - angle) < Math.abs(poses[closest].angle - angle))
    )
      closest = i;
  }
  return closest;
}
