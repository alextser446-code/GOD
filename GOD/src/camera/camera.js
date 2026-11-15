export class Camera {
  constructor() {
    this.zoom = 1;
    this.targetZoom = 1;
    this.minZoom = 0.35;
    this.maxZoom = 6;
    this.zoomSpeed = 0.0015;
    this.smoothness = 0.22;

    this.offsetX = 0;
    this.offsetY = 0;
    this.targetOffsetX = 0;
    this.targetOffsetY = 0;
    this.zoomAnchor = null;

    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.panStartOffsetX = 0;
    this.panStartOffsetY = 0;

    this.visibleBounds = {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    };
  }

  zoomAt(screenX, screenY, wheelDelta) {
    const worldX = (screenX - this.offsetX) / this.zoom;
    const worldY = (screenY - this.offsetY) / this.zoom;
    const zoomFactor = Math.exp(-wheelDelta * this.zoomSpeed);

    this.targetZoom = Math.min(
      this.maxZoom,
      Math.max(this.minZoom, this.targetZoom * zoomFactor)
    );

    this.zoomAnchor = {
      screenX,
      screenY,
      worldX,
      worldY
    };
  }

  beginPan(screenX, screenY) {
    this.isPanning = true;
    this.zoomAnchor = null;
    this.targetZoom = this.zoom;

    this.panStartX = screenX;
    this.panStartY = screenY;
    this.panStartOffsetX = this.offsetX;
    this.panStartOffsetY = this.offsetY;
    this.targetOffsetX = this.offsetX;
    this.targetOffsetY = this.offsetY;
  }

  movePan(screenX, screenY) {
    if (!this.isPanning) {
      return;
    }

    this.targetOffsetX =
      this.panStartOffsetX + screenX - this.panStartX;
    this.targetOffsetY =
      this.panStartOffsetY + screenY - this.panStartY;
  }

  endPan() {
    this.isPanning = false;
  }

  update() {
    const zoomDifference = this.targetZoom - this.zoom;

    if (Math.abs(zoomDifference) < 0.001) {
      this.zoom = this.targetZoom;
    } else {
      this.zoom += zoomDifference * this.smoothness;
    }

    if (this.zoomAnchor) {
      this.offsetX =
        this.zoomAnchor.screenX - this.zoomAnchor.worldX * this.zoom;
      this.offsetY =
        this.zoomAnchor.screenY - this.zoomAnchor.worldY * this.zoom;

      this.targetOffsetX = this.offsetX;
      this.targetOffsetY = this.offsetY;

      if (this.zoom === this.targetZoom) {
        this.zoomAnchor = null;
      }
    } else {
      this.offsetX +=
        (this.targetOffsetX - this.offsetX) * this.smoothness;
      this.offsetY +=
        (this.targetOffsetY - this.offsetY) * this.smoothness;
    }

    const panStillMoving =
      Math.abs(this.targetOffsetX - this.offsetX) >= 0.1 ||
      Math.abs(this.targetOffsetY - this.offsetY) >= 0.1;

    const zoomStillMoving = this.zoom !== this.targetZoom;

    if (!panStillMoving && !this.isPanning) {
      this.offsetX = this.targetOffsetX;
      this.offsetY = this.targetOffsetY;
    }

    return zoomStillMoving || panStillMoving;
  }

  applyToContext(context) {
    context.translate(this.offsetX, this.offsetY);
    context.scale(this.zoom, this.zoom);
  }

  getVisibleBounds(width, height) {
    this.visibleBounds.left = -this.offsetX / this.zoom;
    this.visibleBounds.top = -this.offsetY / this.zoom;
    this.visibleBounds.right = (width - this.offsetX) / this.zoom;
    this.visibleBounds.bottom = (height - this.offsetY) / this.zoom;

    return this.visibleBounds;
  }
}