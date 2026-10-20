import { getEffectiveCollisionRadius } from './objects.ts';
import type { LiveDragPreview } from './input.ts';
import type {
  ClothState,
  GameState,
  PullGestureCommand,
  SimulationConfig,
  TableObject
} from './types.ts';

export interface RenderOptions {
  alpha: number;
  state: GameState;
  config: SimulationConfig;
  cloth: ClothState;
  objects: readonly TableObject[];
  dragPreview: LiveDragPreview | null;
  lastPullCommand?: PullGestureCommand | null;
  reducedMotion: boolean;
  debugOverlay: boolean;
  statusBannerText: string | null;
}

/**
 * Stylized 2.5D Canvas Renderer for Pull It.
 * Maps logical world meters onto the responsive HTML5 Canvas and renders
 * the wooden table, woven cloth + handle, 2.5D objects, gesture guide, and debug shapes.
 */
export class TabletopRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private widthCss: number = 390;
  private heightCss: number = 780;
  private dpr: number = 1;

  /** Scale in CSS pixels per world meter */
  private scale: number = 360;
  /** Screen CSS coordinates of tabletop center (world 0, 0, 0) */
  private originX: number = 195;
  private originY: number = 340;
  /** 2.5D vertical foreshortening factor for tabletop Y axis */
  private readonly yTiltScale = 0.88;
  /** 2.5D elevation scale (how many screen Y pixels per meter of height Z) */
  private readonly zElevationScale = 0.82;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D Canvas context not available');
    }
    this.ctx = context;
    this.resize(configDefaultHalfW, configDefaultHalfL);
  }

  public resize(tableHalfWidth: number, tableHalfLength: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.widthCss = Math.max(280, rect.width || window.innerWidth || 390);
    this.heightCss = Math.max(420, rect.height || window.innerHeight || 780);
    this.dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));

    this.canvas.width = Math.round(this.widthCss * this.dpr);
    this.canvas.height = Math.round(this.heightCss * this.dpr);

    // Ensure full table width + margins AND generous swipe runway below the cloth handle
    const totalWorldW = tableHalfWidth * 2 + 0.16;
    const totalWorldH = tableHalfLength * 2 * this.yTiltScale + 0.56;

    const availW = this.widthCss * 0.92;
    const availH = this.heightCss * 0.82;

    this.scale = Math.min(availW / totalWorldW, availH / totalWorldH);
    this.originX = this.widthCss * 0.5;
    // Place table center at 36% of canvas height so the player has plenty of downward swipe room below the handle
    this.originY = this.heightCss * 0.36;
  }

  /**
   * Projects world meters (wx, wy, wz) to CSS pixel coordinates.
   */
  public worldToScreen(wx: number, wy: number, wz: number = 0): { x: number; y: number } {
    return {
      x: this.originX + wx * this.scale,
      y: this.originY + wy * this.scale * this.yTiltScale - wz * this.scale * this.zElevationScale
    };
  }

  /**
   * Converts client screen coordinates (CSS px relative to canvas) to tabletop world meters (z = 0).
   */
  public screenToWorld(clientX: number, clientY: number): { worldX: number; worldY: number; screenX: number; screenY: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const worldX = (sx - this.originX) / this.scale;
    const worldY = (sy - this.originY) / (this.scale * this.yTiltScale);
    return { worldX, worldY, screenX: sx, screenY: sy };
  }

  /**
   * Returns the world-space bounding area of the interactive cloth handle below the table.
   */
  public getHandleBoundsWorld(config: SimulationConfig, cloth: ClothState): {
    centerX: number;
    centerY: number;
    halfW: number;
    halfH: number;
  } {
    const frontEdgeY = config.tableHalfLength + Math.max(0, cloth.offsetY * 0.45);
    return {
      centerX: cloth.offsetX * 0.5,
      centerY: frontEdgeY + 0.085,
      halfW: 0.24,
      halfH: 0.105
    };
  }

  /**
   * Tests whether a world-space touch point lands inside the cloth handle hit area.
   */
  public isPointInHandle(worldX: number, worldY: number, config: SimulationConfig, cloth: ClothState): boolean {
    if (!cloth.present) return false;
    const bounds = this.getHandleBoundsWorld(config, cloth);
    return (
      Math.abs(worldX - bounds.centerX) <= bounds.halfW &&
      Math.abs(worldY - bounds.centerY) <= bounds.halfH
    );
  }

  public render(opts: RenderOptions): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    this.drawBackground(ctx);

    // Draw objects that have fallen below the table plane first if they are behind the front edge
    const interpFactor = opts.reducedMotion ? 1 : opts.alpha;

    // Draw wooden tabletop
    this.drawTable(ctx, opts.config);

    // Draw tablecloth and handle if present
    if (opts.cloth.present) {
      this.drawClothAndHandle(ctx, opts, interpFactor);
    }

    // Depth-sort objects by interpolated Y so nearer objects render in front of farther ones
    const sorted = [...opts.objects].sort((a, b) => {
      const ay = a.prevY + (a.y - a.prevY) * interpFactor;
      const by = b.prevY + (b.y - b.prevY) * interpFactor;
      return ay - by;
    });

    for (let i = 0; i < sorted.length; i++) {
      this.drawObject(ctx, sorted[i], interpFactor, opts.reducedMotion);
    }

    // Draw live swipe direction arrow & object slide rays while dragging
    if (opts.dragPreview && opts.dragPreview.active) {
      this.drawDragDirectionPreview(ctx, opts.dragPreview, opts.config, opts.cloth, opts.objects);
    }

    // Draw Whip Speed Zone Bar & tactical steering hint
    this.drawWhipSpeedMeter(ctx, opts);

    // Developer debug overlay (footprints, support bounds, velocities)
    if (opts.debugOverlay) {
      this.drawDebugOverlay(ctx, opts.config, opts.objects);
    }

    ctx.restore();
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const grad = ctx.createRadialGradient(
      this.originX,
      this.originY * 0.85,
      40,
      this.originX,
      this.heightCss * 0.5,
      Math.max(this.widthCss, this.heightCss) * 0.75
    );
    grad.addColorStop(0, '#f6efe4');
    grad.addColorStop(0.6, '#eadbc8');
    grad.addColorStop(1, '#d7c2aa');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.widthCss, this.heightCss);
  }

  private drawTable(ctx: CanvasRenderingContext2D, config: SimulationConfig): void {
    const topLeft = this.worldToScreen(-config.tableHalfWidth, -config.tableHalfLength);
    const bottomRight = this.worldToScreen(config.tableHalfWidth, config.tableHalfLength);
    const w = bottomRight.x - topLeft.x;
    const h = bottomRight.y - topLeft.y;
    const cornerR = config.tableCornerRadius * this.scale;
    const frontApronDepth = 22 * (this.scale / 360);

    // Soft ambient floor shadow beneath table
    ctx.save();
    ctx.fillStyle = 'rgba(54, 34, 18, 0.22)';
    this.roundRectPath(ctx, topLeft.x - 8, topLeft.y + 18, w + 16, h + frontApronDepth + 14, cornerR + 6);
    ctx.fill();
    ctx.restore();

    // 2.5D Wooden front edge thickness / bevel apron
    ctx.save();
    const sideGrad = ctx.createLinearGradient(topLeft.x, bottomRight.y - cornerR, bottomRight.x, bottomRight.y);
    sideGrad.addColorStop(0, '#6e4223');
    sideGrad.addColorStop(0.5, '#8c5832');
    sideGrad.addColorStop(1, '#5e371c');
    ctx.fillStyle = sideGrad;
    this.roundRectPath(ctx, topLeft.x, topLeft.y + frontApronDepth, w, h, cornerR);
    ctx.fill();
    ctx.restore();

    // Main oak tabletop surface
    ctx.save();
    this.roundRectPath(ctx, topLeft.x, topLeft.y, w, h, cornerR);
    const woodGrad = ctx.createLinearGradient(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y);
    woodGrad.addColorStop(0, '#c88d55');
    woodGrad.addColorStop(0.5, '#b97a42');
    woodGrad.addColorStop(1, '#9f6431');
    ctx.fillStyle = woodGrad;
    ctx.fill();
    ctx.clip();

    // Subtle procedural wood planks & grain lines
    const plankCount = 6;
    const plankW = w / plankCount;
    ctx.strokeStyle = 'rgba(72, 39, 14, 0.16)';
    ctx.lineWidth = 1.2;
    for (let i = 1; i < plankCount; i++) {
      const px = topLeft.x + i * plankW;
      ctx.beginPath();
      ctx.moveTo(px, topLeft.y);
      ctx.lineTo(px, bottomRight.y);
      ctx.stroke();
    }

    // Warm subtle highlight near top-left
    const sheen = ctx.createRadialGradient(
      topLeft.x + w * 0.32,
      topLeft.y + h * 0.28,
      10,
      topLeft.x + w * 0.32,
      topLeft.y + h * 0.28,
      w * 0.8
    );
    sheen.addColorStop(0, 'rgba(255, 244, 224, 0.22)');
    sheen.addColorStop(1, 'rgba(255, 244, 224, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(topLeft.x, topLeft.y, w, h);

    ctx.restore();

    // Crisp outer rim stroke & inlaid bevel line
    ctx.save();
    this.roundRectPath(ctx, topLeft.x, topLeft.y, w, h, cornerR);
    ctx.strokeStyle = '#6c4020';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const inset = 7;
    this.roundRectPath(
      ctx,
      topLeft.x + inset,
      topLeft.y + inset,
      w - inset * 2,
      h - inset * 2,
      Math.max(4, cornerR - inset)
    );
    ctx.strokeStyle = 'rgba(255, 232, 200, 0.24)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  private drawClothAndHandle(
    ctx: CanvasRenderingContext2D,
    opts: RenderOptions,
    alpha: number
  ): void {
    const { cloth, config, state, reducedMotion } = opts;

    const ox = cloth.prevOffsetX + (cloth.offsetX - cloth.prevOffsetX) * alpha;
    const oy = cloth.prevOffsetY + (cloth.offsetY - cloth.prevOffsetY) * alpha;

    // Clip the tabletop portion of the cloth to the table surface, plus let the front overhang drape down
    const tableTL = this.worldToScreen(-config.tableHalfWidth, -config.tableHalfLength);
    const tableBR = this.worldToScreen(config.tableHalfWidth, config.tableHalfLength);
    const tableW = tableBR.x - tableTL.x;
    const tableH = tableBR.y - tableTL.y;
    const cornerR = config.tableCornerRadius * this.scale;

    const clothMinX = ox - cloth.halfWidth;
    const clothMaxX = ox + cloth.halfWidth;
    const clothMinY = oy - cloth.halfLength;
    const clothMaxY = Math.min(config.tableHalfLength + 0.04, oy + cloth.halfLength);

    const cTL = this.worldToScreen(clothMinX, clothMinY);
    const cBR = this.worldToScreen(clothMaxX, clothMaxY);
    const cw = cBR.x - cTL.x;
    const ch = cBR.y - cTL.y;

    if (ch > 2 && cw > 2) {
      ctx.save();
      // Clip to table + lower drape area so cloth exits cleanly off the front edge
      this.roundRectPath(ctx, tableTL.x, tableTL.y, tableW, tableH + 160, cornerR);
      ctx.clip();

      // Drop shadow of cloth on wooden table
      ctx.fillStyle = 'rgba(45, 28, 12, 0.16)';
      this.roundRectPath(ctx, cTL.x + 2, cTL.y + 4, cw, ch, 10);
      ctx.fill();

      // Main linen fabric fill
      const fabricGrad = ctx.createLinearGradient(cTL.x, cTL.y, cBR.x, cBR.y);
      fabricGrad.addColorStop(0, '#fcfaf5');
      fabricGrad.addColorStop(0.55, '#f4efe6');
      fabricGrad.addColorStop(1, '#e8dfd1');
      ctx.fillStyle = fabricGrad;
      this.roundRectPath(ctx, cTL.x, cTL.y, cw, ch, 9);
      ctx.fill();

      // Subtle woven bistro check stripes
      ctx.save();
      this.roundRectPath(ctx, cTL.x, cTL.y, cw, ch, 9);
      ctx.clip();

      ctx.strokeStyle = 'rgba(196, 77, 62, 0.11)';
      ctx.lineWidth = 6;
      const stripeStep = 28 * (this.scale / 360);
      for (let sx = cTL.x + 14; sx < cBR.x; sx += stripeStep) {
        ctx.beginPath();
        ctx.moveTo(sx, cTL.y);
        ctx.lineTo(sx, cBR.y);
        ctx.stroke();
      }
      for (let sy = cTL.y + 14; sy < cBR.y; sy += stripeStep) {
        ctx.beginPath();
        ctx.moveTo(cTL.x, sy);
        ctx.lineTo(cBR.x, sy);
        ctx.stroke();
      }

      // If re-threading a fresh cloth underneath objects, draw a gentle shimmer wave passing up the cloth
      if (cloth.rethreadProgress < 1 && !reducedMotion) {
        const waveY = cBR.y - cloth.rethreadProgress * ch;
        const waveGrad = ctx.createLinearGradient(0, waveY - 24, 0, waveY + 24);
        waveGrad.addColorStop(0, 'rgba(255,255,255,0)');
        waveGrad.addColorStop(0.5, 'rgba(255,255,255,0.65)');
        waveGrad.addColorStop(1, 'rgba(200,185,165,0)');
        ctx.fillStyle = waveGrad;
        ctx.fillRect(cTL.x, waveY - 24, cw, 48);
      }

      // Ripple folds during active pull
      if (cloth.rippleIntensity > 0.05 && !reducedMotion) {
        ctx.strokeStyle = `rgba(160, 145, 125, ${0.28 * cloth.rippleIntensity})`;
        ctx.lineWidth = 3;
        for (let r = 1; r <= 3; r++) {
          const ry = cTL.y + (ch * r) / 4;
          ctx.beginPath();
          ctx.moveTo(cTL.x + 8, ry);
          ctx.quadraticCurveTo(cTL.x + cw * 0.5, ry + 8 * cloth.rippleIntensity, cBR.x - 8, ry);
          ctx.stroke();
        }
      }

      ctx.restore();

      // Readable crimson stitched hem border around the cloth
      ctx.strokeStyle = '#c84b31';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      this.roundRectPath(ctx, cTL.x + 5, cTL.y + 5, Math.max(4, cw - 10), Math.max(4, ch - 10), 6);
      ctx.stroke();
      ctx.setLineDash([]);

      // Highlight the trailing top hem edge so the player clearly sees it retreating under objects
      ctx.strokeStyle = '#a3331d';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(cTL.x + 4, cTL.y + 1.5);
      ctx.lineTo(cBR.x - 4, cTL.y + 1.5);
      ctx.stroke();

      ctx.restore();
    }

    // Draw the interactive Cloth Handle below the table when in ready/gesture/title/pulling state
    if (state === 'ready' || state === 'gesture' || state === 'title' || state === 'pulling') {
      const hBounds = this.getHandleBoundsWorld(config, cloth);
      const hCenter = this.worldToScreen(hBounds.centerX, hBounds.centerY);
      const handleW = hBounds.halfW * 2 * this.scale * 0.88;
      const handleH = hBounds.halfH * 2 * this.scale * this.yTiltScale * 0.78;
      const hx = hCenter.x - handleW * 0.5;
      const hy = hCenter.y - handleH * 0.5;

      // Fabric drape connecting cloth bottom edge to handle tab
      const drapeTopY = Math.min(hy + 6, Math.max(tableBR.y, cBR.y - 4));
      if (hy > drapeTopY) {
        ctx.save();
        ctx.fillStyle = '#e5dccb';
        ctx.beginPath();
        ctx.moveTo(cTL.x + cw * 0.18, drapeTopY);
        ctx.lineTo(cBR.x - cw * 0.18, drapeTopY);
        ctx.lineTo(hx + handleW, hy + 10);
        ctx.lineTo(hx, hy + 10);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#c84b31';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Handle pill button
      ctx.save();
      const isDragging = state === 'gesture';
      ctx.fillStyle = 'rgba(42, 27, 16, 0.22)';
      this.roundRectPath(ctx, hx, hy + 4, handleW, handleH, 16);
      ctx.fill();

      const hGrad = ctx.createLinearGradient(hx, hy, hx, hy + handleH);
      if (isDragging) {
        hGrad.addColorStop(0, '#d95338');
        hGrad.addColorStop(1, '#b03922');
      } else {
        hGrad.addColorStop(0, '#fffdf9');
        hGrad.addColorStop(1, '#ebe1d1');
      }
      ctx.fillStyle = hGrad;
      this.roundRectPath(ctx, hx, hy, handleW, handleH, 16);
      ctx.fill();

      ctx.strokeStyle = isDragging ? '#fff3eb' : '#c84b31';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Tactile grip ridges + label inside handle
      ctx.fillStyle = isDragging ? '#ffffff' : '#7a2e1d';
      ctx.font = `700 ${Math.round(13 * (this.scale / 360))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelText = isDragging ? 'RELEASE TO WHIP' : '▼ GRAB & SWIPE CLOTH ▼';
      ctx.fillText(labelText, hCenter.x, hCenter.y);
      ctx.restore();
    }
  }

  private drawDragDirectionPreview(
    ctx: CanvasRenderingContext2D,
    preview: LiveDragPreview,
    config: SimulationConfig,
    cloth: ClothState,
    objects: readonly TableObject[]
  ): void {
    const hBounds = this.getHandleBoundsWorld(config, cloth);
    const startScreen = this.worldToScreen(hBounds.centerX, hBounds.centerY - 0.02);

    const arrowLenPx = Math.min(115, Math.max(36, preview.strokeLengthNorm * 85));
    const endX = startScreen.x + preview.clampedDirX * arrowLenPx;
    const endY = startScreen.y + preview.clampedDirY * arrowLenPx;

    ctx.save();

    // 1. Draw neutral intended slide-lane rays from each object on the table
    // Length reflects each object's relative slide propensity (bowl/egg glide far, glass short, plate anchored)
    for (const obj of objects) {
      if (obj.state === 'falling') continue;
      const objStart = this.worldToScreen(obj.x, obj.y, 0);
      const slideMeters =
        obj.type === 'egg'
          ? 0.15
          : obj.type === 'bowl'
            ? 0.13
            : obj.type === 'glass'
              ? 0.032
              : 0.01;
      const objEnd = this.worldToScreen(
        obj.x + preview.clampedDirX * slideMeters,
        obj.y + preview.clampedDirY * slideMeters,
        0
      );

      ctx.strokeStyle = 'rgba(34, 49, 63, 0.52)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(objStart.x, objStart.y);
      ctx.lineTo(objEnd.x, objEnd.y);
      ctx.stroke();

      // Ghost footprint ring at projected slide extent for gliding/rolling objects
      if (slideMeters >= 0.08) {
        const colR = getEffectiveCollisionRadius(obj);
        ctx.strokeStyle = 'rgba(34, 49, 63, 0.36)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(
          objEnd.x,
          objEnd.y,
          colR * this.scale,
          colR * this.scale * this.yTiltScale,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 2. Draw allowed +/- 35 degree sector fan subtly from handle
    const maxRad = (config.maxPullAngleDeg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(startScreen.x, startScreen.y);
    ctx.arc(
      startScreen.x,
      startScreen.y,
      68,
      Math.PI * 0.5 - maxRad,
      Math.PI * 0.5 + maxRad
    );
    ctx.closePath();
    ctx.fillStyle = 'rgba(200, 75, 49, 0.10)';
    ctx.fill();

    // Intended direction vector arrow (neutral color: does not predict success/failure)
    ctx.strokeStyle = preview.willCancel ? 'rgba(120, 110, 100, 0.65)' : 'rgba(44, 62, 80, 0.88)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startScreen.x, startScreen.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Arrowhead
    const angle = Math.atan2(endY - startScreen.y, endX - startScreen.x);
    const headLen = 12;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle - 0.45), endY - headLen * Math.sin(angle - 0.45));
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle + 0.45), endY - headLen * Math.sin(angle + 0.45));
    ctx.stroke();

    // Angle readout pill next to arrow tip
    const degRounded = Math.round(preview.angleDeg);
    const angleLabel =
      preview.willCancel
        ? 'SWIPE FURTHER DOWN'
        : Math.abs(degRounded) <= 3
          ? '0° STRAIGHT'
          : `${degRounded > 0 ? '+' : ''}${degRounded}° ANGLED`;
    ctx.font = '700 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = preview.willCancel ? 'rgba(110, 95, 85, 0.9)' : 'rgba(34, 49, 63, 0.92)';
    ctx.textAlign = 'center';
    ctx.fillText(angleLabel, endX, endY + 18);

    ctx.restore();
  }

  private drawWhipSpeedMeter(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
    const barW = Math.min(280, this.widthCss * 0.78);
    const barH = 12;
    const bx = (this.widthCss - barW) * 0.5;
    const by = this.heightCss - 32;

    ctx.save();

    // Tactical steering hint when multiple objects are on the table
    if (opts.objects.length >= 2 && (opts.state === 'ready' || opts.state === 'gesture')) {
      ctx.font = '700 11px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(72, 41, 20, 0.88)';
      ctx.textAlign = 'center';
      ctx.fillText(
        'SKILL TIP: Angle swipe (-35°..+35°) so gliding bowls/eggs miss fragile glasses!',
        this.widthCss * 0.5,
        by - 14
      );
    }

    // Background track
    this.roundRectPath(ctx, bx, by, barW, barH, 6);
    ctx.fillStyle = 'rgba(48, 32, 20, 0.18)';
    ctx.fill();

    // 3 zones: TOO SLOW (0 - 30%), SWEET SPOT (30% - 76%), OVER-YANK (76% - 100%)
    const slowW = barW * 0.30;
    const sweetW = barW * 0.46;
    const overW = barW * 0.24;

    ctx.fillStyle = 'rgba(217, 130, 43, 0.75)';
    this.roundRectPath(ctx, bx, by, slowW, barH, 6);
    ctx.fill();

    ctx.fillStyle = 'rgba(46, 139, 87, 0.82)';
    ctx.fillRect(bx + slowW, by, sweetW, barH);

    ctx.fillStyle = 'rgba(192, 57, 43, 0.78)';
    this.roundRectPath(ctx, bx + slowW + sweetW, by, overW, barH, 6);
    ctx.fill();

    // Zone labels
    ctx.font = '700 9px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SLOW DRAG', bx + slowW * 0.5, by + barH * 0.5);
    ctx.fillText('★ SWEET SPOT ★', bx + slowW + sweetW * 0.5, by + barH * 0.5);
    ctx.fillText('OVER-YANK', bx + slowW + sweetW + overW * 0.5, by + barH * 0.5);

    // Marker for last pull speed
    if (opts.lastPullCommand) {
      const minS = opts.config.minExtractionSpeedMps;
      const maxS = opts.config.maxExtractionSpeedMps;
      const u = Math.max(0, Math.min(1, (opts.lastPullCommand.extractionSpeedMps - minS) / (maxS - minS)));
      const mx = bx + u * barW;
      ctx.fillStyle = '#1e272e';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, by + barH * 0.5, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawObject(
    ctx: CanvasRenderingContext2D,
    obj: TableObject,
    alpha: number,
    reducedMotion: boolean
  ): void {
    const ix = obj.prevX + (obj.x - obj.prevX) * alpha;
    const iy = obj.prevY + (obj.y - obj.prevY) * alpha;
    const iz = obj.prevZ + (obj.z - obj.prevZ) * alpha;
    const iyaw = obj.prevYaw + (obj.yaw - obj.prevYaw) * alpha;
    const itiltX = obj.prevTiltX + (obj.tiltX - obj.prevTiltX) * alpha;
    const itiltY = obj.prevTiltY + (obj.tiltY - obj.prevTiltY) * alpha;

    // Visual spawn arrival bounce (does not modify simulated x, y)
    let spawnLiftMeters = 0;
    let squashX = 1;
    let squashY = 1;
    if (obj.spawnAnimProgress < 1 && !reducedMotion) {
      const p = obj.spawnAnimProgress;
      if (p < 0.6) {
        const u = p / 0.6;
        spawnLiftMeters = (1 - u * u) * 0.11;
      } else {
        const b = (p - 0.6) / 0.4;
        const squash = Math.sin(b * Math.PI) * 0.08;
        squashX = 1 + squash;
        squashY = 1 - squash * 0.7;
      }
    }

    const basePos = this.worldToScreen(ix, iy, iz + spawnLiftMeters);
    // Top of object shifts laterally with tilt angle and vertically with cos(tilt)
    const tiltMag = Math.hypot(itiltX, itiltY);
    const topWorldX = ix + Math.sin(itiltX) * obj.height;
    const topWorldY = iy + Math.sin(itiltY) * obj.height;
    const topWorldZ = iz + spawnLiftMeters + Math.cos(Math.min(Math.PI * 0.48, tiltMag)) * obj.height;
    const topPos = this.worldToScreen(topWorldX, topWorldY, topWorldZ);

    // Draw soft contact shadow on the tabletop
    const shadowPos = this.worldToScreen(ix + 0.008, iy + 0.012, Math.min(0, iz));
    const shadowRx = obj.visualRadiusX * this.scale * squashX * 1.04;
    const shadowRy = obj.visualRadiusY * this.scale * this.yTiltScale * squashY * 1.04;

    ctx.save();
    ctx.fillStyle = obj.state === 'falling' ? 'rgba(30, 18, 8, 0.10)' : 'rgba(38, 22, 10, 0.24)';
    ctx.beginPath();
    ctx.ellipse(shadowPos.x, shadowPos.y + 3, shadowRx, shadowRy, iyaw, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (obj.type === 'glass') {
      this.drawGlass(ctx, obj, basePos, topPos, squashX, squashY);
    } else if (obj.type === 'plate') {
      this.drawPlate(ctx, obj, basePos, topPos, iyaw, squashX, squashY);
    } else if (obj.type === 'egg') {
      this.drawEgg(ctx, obj, basePos, topPos, iyaw, itiltX, itiltY, squashX, squashY);
    } else {
      this.drawBowl(ctx, obj, basePos, topPos, squashX, squashY);
    }

    // Warning ring when rocking or persistently leaning or near table edge
    const tiltRatio = tiltMag / obj.criticalTiltRad;
    const nearEdge =
      Math.abs(ix) + obj.footprintRadiusX > 0.30 ||
      Math.abs(iy) + obj.footprintRadiusY > 0.37;

    if ((tiltRatio > 0.22 || nearEdge) && obj.state !== 'falling' && obj.state !== 'tipped') {
      ctx.save();
      ctx.strokeStyle =
        tiltRatio > 0.55 || nearEdge
          ? 'rgba(217, 68, 42, 0.82)'
          : 'rgba(230, 145, 35, 0.75)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.ellipse(
        basePos.x,
        basePos.y,
        obj.footprintRadiusX * this.scale * 1.28,
        obj.footprintRadiusY * this.scale * this.yTiltScale * 1.28,
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // If this object caused failure, draw a clear physical cause callout badge
    if ((obj.state === 'tipped' || obj.state === 'falling') && obj.failureReason) {
      this.drawFailureBadge(ctx, topPos.x, Math.min(basePos.y, topPos.y) - 24, obj.failureReason);
    }
  }

  private drawGlass(
    ctx: CanvasRenderingContext2D,
    obj: TableObject,
    basePos: { x: number; y: number },
    topPos: { x: number; y: number },
    squashX: number,
    squashY: number
  ): void {
    const baseR = obj.footprintRadiusX * this.scale * squashX;
    const baseRy = baseR * this.yTiltScale * squashY;
    const rimR = obj.visualRadiusX * this.scale * squashX;
    const rimRy = rimR * this.yTiltScale * squashY;

    const dx = topPos.x - basePos.x;
    const dy = topPos.y - basePos.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    // Perpendicular unit vector to the glass axis in 2D screen space
    const px = -dy / len;
    const py = dx / len;

    ctx.save();

    // Heavy glass base disc
    ctx.fillStyle = 'rgba(186, 224, 242, 0.78)';
    ctx.strokeStyle = '#2b5d78';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(basePos.x, basePos.y, baseR, baseRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Water/liquid fill inside lower 58% of the glass
    const liqTopX = basePos.x + dx * 0.56;
    const liqTopY = basePos.y + dy * 0.56;
    const liqR = baseR + (rimR - baseR) * 0.56;
    const liqRy = liqR * this.yTiltScale;

    ctx.fillStyle = 'rgba(56, 168, 222, 0.52)';
    ctx.beginPath();
    ctx.moveTo(basePos.x - px * baseR * 0.9, basePos.y - py * baseR * 0.9);
    ctx.lineTo(liqTopX - px * liqR * 0.92, liqTopY - py * liqR * 0.92);
    ctx.lineTo(liqTopX + px * liqR * 0.92, liqTopY + py * liqR * 0.92);
    ctx.lineTo(basePos.x + px * baseR * 0.9, basePos.y + py * baseR * 0.9);
    ctx.closePath();
    ctx.fill();

    // Liquid top meniscus ellipse
    ctx.fillStyle = 'rgba(92, 198, 245, 0.68)';
    ctx.beginPath();
    ctx.ellipse(liqTopX, liqTopY, liqR * 0.92, liqRy * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();

    // Translucent glass walls
    const wallGrad = ctx.createLinearGradient(
      topPos.x - rimR,
      topPos.y,
      topPos.x + rimR,
      topPos.y
    );
    wallGrad.addColorStop(0, 'rgba(235, 248, 255, 0.55)');
    wallGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.72)');
    wallGrad.addColorStop(0.75, 'rgba(180, 218, 238, 0.35)');
    wallGrad.addColorStop(1, 'rgba(220, 242, 252, 0.60)');

    ctx.fillStyle = wallGrad;
    ctx.strokeStyle = '#244f66';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(basePos.x - px * baseR, basePos.y - py * baseR);
    ctx.lineTo(topPos.x - px * rimR, topPos.y - py * rimR);
    ctx.lineTo(topPos.x + px * rimR, topPos.y + py * rimR);
    ctx.lineTo(basePos.x + px * baseR, basePos.y + py * baseR);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Vertical specular reflection stripe (gives crisp silhouette on small screens)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(basePos.x - px * baseR * 0.45, basePos.y - py * baseR * 0.45);
    ctx.lineTo(topPos.x - px * rimR * 0.45, topPos.y - py * rimR * 0.45);
    ctx.stroke();

    // Top glass rim ellipse
    ctx.fillStyle = 'rgba(240, 252, 255, 0.38)';
    ctx.strokeStyle = '#1f475c';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(topPos.x, topPos.y, rimR, rimRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawPlate(
    ctx: CanvasRenderingContext2D,
    obj: TableObject,
    basePos: { x: number; y: number },
    topPos: { x: number; y: number },
    yaw: number,
    squashX: number,
    squashY: number
  ): void {
    const outerRx = obj.visualRadiusX * this.scale * squashX;
    const outerRy = obj.visualRadiusY * this.scale * this.yTiltScale * squashY;
    const innerRx = obj.footprintRadiusX * 0.76 * this.scale * squashX;
    const innerRy = obj.footprintRadiusY * 0.76 * this.scale * this.yTiltScale * squashY;

    ctx.save();
    // Base ceramic foot shadow/edge
    ctx.fillStyle = '#d6cfc2';
    ctx.strokeStyle = '#5c5346';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(basePos.x, basePos.y + 2, outerRx * 0.92, outerRy * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Main wide plate rim
    const rimGrad = ctx.createRadialGradient(
      topPos.x - outerRx * 0.25,
      topPos.y - outerRy * 0.25,
      innerRx * 0.2,
      topPos.x,
      topPos.y,
      outerRx
    );
    rimGrad.addColorStop(0, '#ffffff');
    rimGrad.addColorStop(0.75, '#f5f0e6');
    rimGrad.addColorStop(1, '#dfd7c8');

    ctx.fillStyle = rimGrad;
    ctx.strokeStyle = '#4a4238';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(topPos.x, topPos.y, outerRx, outerRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Decorative cobalt blue bistro rim band + cardinal ticks (shows rotation & distinguishes silhouette)
    ctx.strokeStyle = '#2d5a88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(topPos.x, topPos.y, outerRx * 0.88, outerRy * 0.88, 0, 0, Math.PI * 2);
    ctx.stroke();

    for (let k = 0; k < 8; k++) {
      const a = yaw + (k * Math.PI) / 4;
      const x0 = topPos.x + Math.cos(a) * outerRx * 0.82;
      const y0 = topPos.y + Math.sin(a) * outerRy * 0.82;
      const x1 = topPos.x + Math.cos(a) * outerRx * 0.93;
      const y1 = topPos.y + Math.sin(a) * outerRy * 0.93;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Inner recessed plate well
    ctx.fillStyle = '#ece5d8';
    ctx.strokeStyle = '#b5ab99';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(topPos.x, topPos.y + 1, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawEgg(
    ctx: CanvasRenderingContext2D,
    obj: TableObject,
    basePos: { x: number; y: number },
    topPos: { x: number; y: number },
    yaw: number,
    tiltX: number,
    tiltY: number,
    squashX: number,
    squashY: number
  ): void {
    const rx = obj.visualRadiusX * this.scale * squashX * 1.05;
    const ry = obj.visualRadiusY * this.scale * this.yTiltScale * squashY * 1.12;
    const centerX = (basePos.x + topPos.x) * 0.5;
    const centerY = (basePos.y + topPos.y) * 0.5;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(yaw + tiltX * 0.25);

    // Draw tapered ovoid egg path (wider at left/blunt end, narrower at right/pointed end)
    ctx.beginPath();
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      // Taper factor creates authentic egg silhouette
      const taper = 1 - 0.22 * cosT;
      const px = cosT * rx;
      const py = sinT * ry * taper;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    const eggGrad = ctx.createRadialGradient(
      -rx * 0.25,
      -ry * 0.35 + tiltY * 4,
      2,
      0,
      0,
      rx * 1.1
    );
    eggGrad.addColorStop(0, '#fff9f0');
    eggGrad.addColorStop(0.55, '#f2cfa8');
    eggGrad.addColorStop(1, '#c99563');

    ctx.fillStyle = eggGrad;
    ctx.fill();
    ctx.strokeStyle = '#6e4726';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Organic shell speckles (visually distinct texture even without color)
    ctx.fillStyle = 'rgba(110, 65, 32, 0.55)';
    const speckles = [
      [-0.35, -0.2, 1.8],
      [0.15, -0.32, 1.4],
      [0.42, 0.08, 1.7],
      [-0.1, 0.28, 2.0],
      [0.25, 0.24, 1.3],
      [-0.48, 0.15, 1.5]
    ];
    for (let i = 0; i < speckles.length; i++) {
      const [sx, sy, sr] = speckles[i];
      ctx.beginPath();
      ctx.arc(sx * rx, sy * ry, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gloss highlight dot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.beginPath();
    ctx.ellipse(-rx * 0.28, -ry * 0.3, rx * 0.22, ry * 0.14, -0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawBowl(
    ctx: CanvasRenderingContext2D,
    obj: TableObject,
    basePos: { x: number; y: number },
    topPos: { x: number; y: number },
    squashX: number,
    squashY: number
  ): void {
    const footRx = obj.footprintRadiusX * this.scale * squashX;
    const footRy = footRx * this.yTiltScale * squashY;
    const rimRx = obj.visualRadiusX * this.scale * squashX;
    const rimRy = rimRx * this.yTiltScale * squashY;

    ctx.save();

    // Ceramic unglazed foot ring
    ctx.fillStyle = '#c4b299';
    ctx.strokeStyle = '#5c4b37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(basePos.x, basePos.y, footRx, footRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Rounded stoneware bowl body connecting foot to flared top rim
    const bodyGrad = ctx.createLinearGradient(
      topPos.x - rimRx,
      topPos.y,
      topPos.x + rimRx,
      basePos.y
    );
    bodyGrad.addColorStop(0, '#5a8f76');
    bodyGrad.addColorStop(0.45, '#467860');
    bodyGrad.addColorStop(1, '#2c5240');

    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#1f3b2e';
    ctx.lineWidth = 2.4;

    ctx.beginPath();
    ctx.moveTo(topPos.x - rimRx, topPos.y);
    ctx.quadraticCurveTo(
      basePos.x - rimRx * 0.92,
      basePos.y + footRy * 0.4,
      basePos.x - footRx,
      basePos.y
    );
    ctx.lineTo(basePos.x + footRx, basePos.y);
    ctx.quadraticCurveTo(
      basePos.x + rimRx * 0.92,
      basePos.y + footRy * 0.4,
      topPos.x + rimRx,
      topPos.y
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Decorative cream stripe around the bowl exterior
    const midX = (basePos.x + topPos.x) * 0.5;
    const midY = (basePos.y + topPos.y) * 0.54;
    const midRx = (footRx + rimRx) * 0.53;
    const midRy = (footRy + rimRy) * 0.53;
    ctx.strokeStyle = 'rgba(247, 239, 222, 0.78)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(midX, midY, midRx, midRy, 0, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();

    // Bowl interior cavity (concave dark cream glaze)
    const wellGrad = ctx.createRadialGradient(
      topPos.x,
      topPos.y + rimRy * 0.2,
      rimRx * 0.1,
      topPos.x,
      topPos.y,
      rimRx
    );
    wellGrad.addColorStop(0, '#d8ccb8');
    wellGrad.addColorStop(0.75, '#efe6d5');
    wellGrad.addColorStop(1, '#fbf7f0');

    ctx.fillStyle = wellGrad;
    ctx.strokeStyle = '#1f3b2e';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(topPos.x, topPos.y, rimRx, rimRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawFailureBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string
  ): void {
    ctx.save();
    ctx.font = '700 12px system-ui, -apple-system, sans-serif';
    const padX = 10;
    const metrics = ctx.measureText(text);
    const w = metrics.width + padX * 2;
    const h = 24;
    const bx = Math.max(8, Math.min(this.widthCss - w - 8, x - w * 0.5));
    const by = Math.max(54, y - h);

    ctx.fillStyle = 'rgba(184, 42, 28, 0.94)';
    this.roundRectPath(ctx, bx, by, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w * 0.5, by + h * 0.5);
    ctx.restore();
  }

  private drawDebugOverlay(
    ctx: CanvasRenderingContext2D,
    config: SimulationConfig,
    objects: readonly TableObject[]
  ): void {
    ctx.save();

    // 1. Draw tabletop physical edge outline
    const tl = this.worldToScreen(-config.tableHalfWidth, -config.tableHalfLength);
    const br = this.worldToScreen(config.tableHalfWidth, config.tableHalfLength);
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    this.roundRectPath(
      ctx,
      tl.x,
      tl.y,
      br.x - tl.x,
      br.y - tl.y,
      config.tableCornerRadius * this.scale
    );
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. For each object, draw collision circle, base footprint ellipse, COM projection, and velocity
    for (const obj of objects) {
      const p = this.worldToScreen(obj.x, obj.y, 0);
      const colR = getEffectiveCollisionRadius(obj);

      // Outer collision boundary (yellow dashed)
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(
        p.x,
        p.y,
        colR * this.scale,
        colR * this.scale * this.yTiltScale,
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // Base support footprint (lime green solid)
      ctx.strokeStyle = '#00ff66';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(
        p.x,
        p.y,
        obj.footprintRadiusX * this.scale,
        obj.footprintRadiusY * this.scale * this.yTiltScale,
        obj.yaw,
        0,
        Math.PI * 2
      );
      ctx.stroke();

      // Projected Center of Mass shift (magenta dot)
      const comX = obj.x + Math.sin(obj.tiltX) * obj.comHeight * 0.65;
      const comY = obj.y + Math.sin(obj.tiltY) * obj.comHeight * 0.65;
      const comScreen = this.worldToScreen(comX, comY, 0);
      ctx.fillStyle = '#ff2a85';
      ctx.beginPath();
      ctx.arc(comScreen.x, comScreen.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Velocity vector (cyan line)
      const vEnd = this.worldToScreen(obj.x + obj.vx * 0.25, obj.y + obj.vy * 0.25, 0);
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(vEnd.x, vEnd.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const radius = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

const configDefaultHalfW = 0.36;
const configDefaultHalfL = 0.44;
