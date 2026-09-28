import { describe, expect, it } from 'vitest';
import { FAN, fanPoses, hitFan } from '@/components/cards/fan-geometry';

describe('半圆环几何', () => {
  it('预选只柔和散开附近牌，远处牌和整个牌扇保持稳定', () => {
    const focus = 38;
    const base = fanPoses(78, null, null);
    const poses = fanPoses(78, focus, focus);
    for (const direction of [-1, 1]) {
      const offsets = [1, 2, 3, 4].map((distance) => {
        const index = focus + direction * distance;
        return direction * (poses[index].angle - base[index].angle);
      });
      expect(offsets[0]).toBeGreaterThan(offsets[1]);
      expect(offsets[1]).toBeGreaterThan(offsets[2]);
      expect(offsets[2]).toBeGreaterThan(offsets[3]);
      expect(offsets[3]).toBeGreaterThan(0);
    }
    for (let index = 0; index < poses.length; index++) {
      if (Math.abs(index - focus) >= 8) expect(poses[index]).toEqual(base[index]);
    }
  });

  it('邻牌抬升随距离逐渐衰减，松开预选后只保留散开位置', () => {
    const focus = 38;
    const poses = fanPoses(78, focus, focus);
    const radius = (index: number) => Math.hypot(poses[index].x - FAN.cx, FAN.cy - poses[index].y);
    expect(radius(focus)).toBeCloseTo(FAN.radius + FAN.lift);
    expect(radius(focus + 1)).toBeGreaterThan(radius(focus + 2));
    expect(radius(focus + 2)).toBeGreaterThan(radius(focus + 3));
    expect(radius(focus + 3)).toBeGreaterThan(FAN.radius);
    const resting = fanPoses(78, focus, null);
    for (let index = 0; index < resting.length; index++) {
      expect(resting[index].angle).toBe(poses[index].angle);
      expect(Math.hypot(resting[index].x - FAN.cx, FAN.cy - resting[index].y)).toBeCloseTo(
        FAN.radius,
      );
    }
  });

  it('小牌堆和边缘预选也保持有限坐标、有序和固定端点', () => {
    for (const count of [1, 2, 3, 5, 8, 16]) {
      for (let focus = 0; focus < count; focus++) {
        const poses = fanPoses(count, focus, focus);
        expect(poses.every((pose) => Object.values(pose).every(Number.isFinite))).toBe(true);
        if (count > 1) {
          expect(poses[0].angle).toBe(-90);
          expect(poses[count - 1].angle).toBe(90);
        }
        for (let index = 1; index < count; index++)
          expect(poses[index].angle).toBeGreaterThan(poses[index - 1].angle);
      }
    }
  });

  it('每个预选位置都有序、完整、无重合，并保留自身原角度', () => {
    const base = fanPoses(78, null, null);
    for (let focus = 0; focus < 78; focus++) {
      const poses = fanPoses(78, focus, focus);
      expect(poses[focus].angle).toBe(base[focus].angle);
      expect(poses[0].angle).toBeCloseTo(-90);
      expect(poses[77].angle).toBeCloseTo(90);
      for (let i = 1; i < poses.length; i++)
        expect(poses[i].angle).toBeGreaterThan(poses[i - 1].angle);
      for (const pose of poses) {
        const radians = (pose.angle * Math.PI) / 180;
        const halfWidth =
          (Math.abs(Math.cos(radians)) * FAN.cardWidth +
            Math.abs(Math.sin(radians)) * FAN.cardHeight) /
          2;
        const halfHeight =
          (Math.abs(Math.sin(radians)) * FAN.cardWidth +
            Math.abs(Math.cos(radians)) * FAN.cardHeight) /
          2;
        expect(pose.x - halfWidth).toBeGreaterThanOrEqual(0);
        expect(pose.x + halfWidth).toBeLessThanOrEqual(FAN.width);
        expect(pose.y - halfHeight).toBeGreaterThanOrEqual(0);
        expect(pose.y + halfHeight).toBeLessThanOrEqual(FAN.height);
      }
    }
  });
  it('牌环留白不命中、滑动不命中已抽牌，小牌堆也不产生非数坐标', () => {
    const poses = fanPoses(78, null, null);
    expect(hitFan(FAN.cx, FAN.cy, poses, [])).toBeNull();
    expect(hitFan(poses[0].x, poses[0].y, poses, [0])).not.toBe(0);
    for (const count of [0, 1, 2, 3]) {
      const small = fanPoses(count, count ? 0 : null, null);
      expect(small).toHaveLength(count);
      expect(small.every((pose) => Object.values(pose).every(Number.isFinite))).toBe(true);
    }
  });
});
