"""
main.py - 断面画像解析・3D再構築ツール
UI: CustomTkinter
"""
import tkinter as tk
from tkinter import filedialog, messagebox
import customtkinter as ctk
import threading
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageTk

from analyzer import analyze_image
from analyzer_mec import analyze_image_mec
from geometry import (
    cone_height, fit_plane, z_from_plane,
    points_to_3d, compute_mm_per_px,
)
from visualizer import visualize_3d

# ── テーマ設定
ctk.set_appearance_mode("light")
ctk.set_default_color_theme("blue")


def _imread(path: str) -> np.ndarray | None:
    """cv2.imread の日本語・Unicode パス対応版"""
    try:
        buf = np.fromfile(path, dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        return img
    except Exception:
        return None

CONE_COLORS = ["#FF5555", "#55DD55", "#5599FF", "#FFAA33"]
CYL_COLOR   = "#FF44FF"


# ════════════════════════════════════════════════════════════════
# ImageCanvas  （tk.Canvas ベース ─ ctk に Canvas なし）
# ════════════════════════════════════════════════════════════════
class ImageCanvas(ctk.CTkFrame):
    def __init__(self, parent, **kwargs):
        super().__init__(parent, fg_color="#1c1c1e", **kwargs)

        self.canvas = tk.Canvas(self, bg="#1c1c1e", cursor="crosshair",
                                highlightthickness=0)
        sx = ctk.CTkScrollbar(self, orientation="horizontal",
                               command=self.canvas.xview)
        sy = ctk.CTkScrollbar(self, orientation="vertical",
                               command=self.canvas.yview)
        self.canvas.configure(xscrollcommand=sx.set, yscrollcommand=sy.set)

        sx.pack(side="bottom", fill="x")
        sy.pack(side="right",  fill="y")
        self.canvas.pack(fill="both", expand=True)

        self._pil      = None
        self._tkimg    = None
        self._scale    = 1.0
        self._circles  = []
        self._selected = None
        self._drag_xy  = None
        self._drag_mode= None

        self.on_changed = None

        self.canvas.bind("<Button-1>",        self._click)
        self.canvas.bind("<B1-Motion>",       self._drag)
        self.canvas.bind("<ButtonRelease-1>", self._release)
        self.canvas.bind("<MouseWheel>",      self._wheel)
        self.canvas.bind("<Button-3>",        self._rclick)
        self.canvas.bind("<Double-Button-1>", self._dblclick)

    # ── Public ──────────────────────────────────────────────────

    def set_image(self, pil: Image.Image):
        self._pil = pil
        self.update_idletasks()
        cw = self.canvas.winfo_width()  or 800
        ch = self.canvas.winfo_height() or 600
        self._scale = min(cw / pil.width, ch / pil.height, 1.0)
        self._redraw()

    def set_circles(self, cylinder, cones, locked_cyl=False, locked_cones=None):
        locked_cones = locked_cones or []
        self._circles = []
        if cylinder:
            cx, cy, r = cylinder
            self._circles.append({"type":"cylinder","cx":float(cx),"cy":float(cy),"r":float(r),
                                   "color":CYL_COLOR,"confirmed":locked_cyl})
        for i, c in enumerate(cones):
            self._circles.append({"type":"cone","index":i,
                                   "cx":float(c[0]),"cy":float(c[1]),"r":float(c[2]),
                                   "color":CONE_COLORS[i%len(CONE_COLORS)],
                                   "confirmed": i < len(locked_cones) and locked_cones[i]})
        self._draw_circles()

    def get_cylinder(self):
        for c in self._circles:
            if c["type"] == "cylinder":
                return [int(c["cx"]), int(c["cy"]), int(c["r"])]
        return None

    def get_cones(self):
        cones = sorted([c for c in self._circles if c["type"]=="cone"],
                       key=lambda x: x.get("index",0))
        return [[int(c["cx"]), int(c["cy"]), int(c["r"])] for c in cones]

    # ── 描画 ────────────────────────────────────────────────────

    def _redraw(self):
        self.canvas.delete("all")
        if self._pil is None:
            return
        iw = int(self._pil.width  * self._scale)
        ih = int(self._pil.height * self._scale)
        self._tkimg = ImageTk.PhotoImage(self._pil.resize((iw, ih), Image.LANCZOS))
        self.canvas.create_image(0, 0, anchor="nw", image=self._tkimg, tags="img")
        self.canvas.configure(scrollregion=(0, 0, iw, ih))
        self._draw_circles()

    def _draw_circles(self):
        self.canvas.delete("overlay")
        s = self._scale
        for i, c in enumerate(self._circles):
            cx, cy, r = c["cx"]*s, c["cy"]*s, c["r"]*s
            col       = c["color"]
            confirmed = c.get("confirmed", False)
            selected  = c is self._selected
            lw        = (4 if confirmed else 2) + (1 if selected else 0)

            # 確定: 実線・太め  /  未確定: 破線
            if confirmed:
                dash = ()
            else:
                dash = () if c["type"] == "cylinder" else (6, 3)

            self.canvas.create_oval(cx-r, cy-r, cx+r, cy+r,
                                    outline=col, width=lw, dash=dash, tags="overlay")

            # ラベル（確定には ✓ を付加）
            base = "Cyl" if c["type"] == "cylinder" else f"C{c.get('index', i)}"
            lbl  = base + ("✓" if confirmed else "")
            self.canvas.create_text(cx, cy-r-9, text=lbl, fill=col,
                                    font=("Arial", 9, "bold"), tags="overlay")

            # リサイズハンドル（確定時は金色）
            hc = "#FFD700" if confirmed else col
            self.canvas.create_oval(cx+r-6, cy-6, cx+r+6, cy+6,
                                    fill=hc, outline="white", width=1, tags="overlay")

    # ── 座標変換 ─────────────────────────────────────────────────

    def _ixy(self, event):
        cx = self.canvas.canvasx(event.x)
        cy = self.canvas.canvasy(event.y)
        return cx/self._scale, cy/self._scale

    def _hit(self, ix, iy):
        for c in reversed(self._circles):
            dx, dy = ix-c["cx"], iy-c["cy"]
            if abs(dx-c["r"])<8/self._scale and abs(dy)<8/self._scale:
                return c, "resize"
            if (dx**2+dy**2)**0.5 < c["r"]+6/self._scale:
                return c, "move"
        return None, None

    # ── イベント ─────────────────────────────────────────────────

    def _click(self, e):
        ix, iy = self._ixy(e)
        c, mode = self._hit(ix, iy)
        self._selected  = c
        self._drag_xy   = (ix, iy)
        self._drag_mode = mode
        self._draw_circles()

    def _drag(self, e):
        if not self._selected or not self._drag_xy:
            return
        ix, iy = self._ixy(e)
        dx, dy = ix-self._drag_xy[0], iy-self._drag_xy[1]
        if self._drag_mode == "move":
            self._selected["cx"] += dx
            self._selected["cy"] += dy
        elif self._drag_mode == "resize":
            self._selected["r"] = max(4.0, ((ix-self._selected["cx"])**2+(iy-self._selected["cy"])**2)**0.5)
        self._drag_xy = (ix, iy)
        self._draw_circles()

    def _release(self, _):
        if self._drag_xy and self.on_changed:
            self.on_changed()
        self._drag_xy = None

    def _wheel(self, e):
        f = 1.15 if e.delta > 0 else 1/1.15
        self._scale = max(0.05, min(10.0, self._scale*f))
        self._redraw()

    def _rclick(self, e):
        ix, iy = self._ixy(e)
        c, _ = self._hit(ix, iy)
        if c and c["type"] == "cone":
            self._circles.remove(c)
            for i, cc in enumerate(x for x in self._circles if x["type"]=="cone"):
                cc["index"] = i
            self._draw_circles()
            if self.on_changed:
                self.on_changed()

    def _dblclick(self, e):
        ix, iy = self._ixy(e)
        c, _ = self._hit(ix, iy)
        if c is None:
            n = sum(1 for x in self._circles if x["type"]=="cone")
            self._circles.append({"type":"cone","index":n,
                                   "cx":ix,"cy":iy,"r":20.0,
                                   "color":CONE_COLORS[n%len(CONE_COLORS)]})
            self._draw_circles()
            if self.on_changed:
                self.on_changed()


# ════════════════════════════════════════════════════════════════
# App
# ════════════════════════════════════════════════════════════════
class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("断面画像解析・3D再構築ツール")
        self.geometry("1480x920")
        self.minsize(960, 640)

        self.image_paths: list[str] = []
        self.current_index = -1
        self.results: dict = {}
        self._cv_img: np.ndarray | None = None
        self._analyzing = False
        # 確定データ: {img_idx: {"cylinder": [cx,cy,r]|None, "cones": [|None × 4]}}
        self._locked: dict = {}

        self._build()
        self._set_status("準備完了 ─ フォルダを開いてください")

    # ─── レイアウト ────────────────────────────────────────────

    def _build(self):
        self.grid_columnconfigure(0, weight=0, minsize=220)
        self.grid_columnconfigure(1, weight=1)
        self.grid_columnconfigure(2, weight=0, minsize=280)
        self.grid_rowconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=0)
        self.grid_rowconfigure(2, weight=0)

        # ─ 左パネル
        left = ctk.CTkFrame(self, width=220, corner_radius=0)
        left.grid(row=0, column=0, sticky="nsew")
        left.grid_rowconfigure(1, weight=1)
        left.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(left, text="画像一覧",
                     font=ctk.CTkFont(size=14, weight="bold")).grid(
            row=0, column=0, pady=(12,4))

        # Listbox（ctk に Listbox なし → tk.Listbox をダーク配色で）
        lf = ctk.CTkFrame(left, fg_color="transparent")
        lf.grid(row=1, column=0, sticky="nsew", padx=8)
        lf.grid_rowconfigure(0, weight=1)
        lf.grid_columnconfigure(0, weight=1)

        self._listbox = tk.Listbox(
            lf, selectmode="single", activestyle="dotbox",
            bg="#2b2b2b", fg="#e0e0e0",
            selectbackground="#1a6fb5", selectforeground="white",
            font=("Arial", 10), bd=0, highlightthickness=0,
            relief="flat",
        )
        sb = ctk.CTkScrollbar(lf, command=self._listbox.yview)
        self._listbox.configure(yscrollcommand=sb.set)
        self._listbox.grid(row=0, column=0, sticky="nsew")
        sb.grid(row=0, column=1, sticky="ns")
        self._listbox.bind("<<ListboxSelect>>", self._on_select)

        btn_f = ctk.CTkFrame(left, fg_color="transparent")
        btn_f.grid(row=2, column=0, sticky="ew", padx=8, pady=8)
        ctk.CTkButton(btn_f, text="現在を解析", height=32,
                      command=self._analyze_current).pack(fill="x", pady=2)
        ctk.CTkButton(btn_f, text="全画像を解析", height=32,
                      fg_color="#2d6a2d", hover_color="#3d8a3d",
                      command=self._analyze_all).pack(fill="x", pady=2)

        # ─ 中央キャンバス
        self._canvas = ImageCanvas(self)
        self._canvas.grid(row=0, column=1, sticky="nsew", padx=4, pady=4)
        self._canvas.on_changed = self._on_circles_changed

        # ─ 右パネル
        right = ctk.CTkFrame(self, width=280, corner_radius=0)
        right.grid(row=0, column=2, sticky="nsew")
        right.grid_rowconfigure(6, weight=1)
        right.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(right, text="パラメータ",
                     font=ctk.CTkFont(size=14, weight="bold")).grid(
            row=0, column=0, pady=(12,4))

        # 検出メソッド切り替え
        mf = ctk.CTkFrame(right)
        mf.grid(row=1, column=0, sticky="ew", padx=10, pady=(0,4))
        mf.grid_columnconfigure((0,1), weight=1)
        ctk.CTkLabel(mf, text="検出方式", anchor="w",
                     font=ctk.CTkFont(size=11)).grid(
            row=0, column=0, columnspan=2, sticky="w", padx=8, pady=(6,2))
        self._method_var = tk.StringVar(value="hough")
        self._btn_hough = ctk.CTkButton(
            mf, text="Hough（デフォルト）", height=28,
            command=lambda: self._set_method("hough"))
        self._btn_hough.grid(row=1, column=0, padx=(8,2), pady=(0,6), sticky="ew")
        self._btn_mec = ctk.CTkButton(
            mf, text="最小外接円", height=28,
            fg_color="#555555", hover_color="#666666",
            command=lambda: self._set_method("mec"))
        self._btn_mec.grid(row=1, column=1, padx=(2,8), pady=(0,6), sticky="ew")

        # パラメータ
        pf = ctk.CTkFrame(right)
        pf.grid(row=2, column=0, sticky="ew", padx=10, pady=4)
        self._build_params(pf)

        # ボタン
        bf = ctk.CTkFrame(right, fg_color="transparent")
        bf.grid(row=3, column=0, sticky="ew", padx=10, pady=4)
        ctk.CTkButton(bf, text="JSON エクスポート", height=34,
                      command=self._export_json).pack(fill="x", pady=2)
        ctk.CTkButton(bf, text="3D 表示", height=34,
                      fg_color="#6a2d7a", hover_color="#8a3d9a",
                      command=self._show_3d).pack(fill="x", pady=2)

        # 確定パネル
        lf = ctk.CTkFrame(right)
        lf.grid(row=4, column=0, sticky="ew", padx=10, pady=(0,4))
        self._build_lock_panel(lf)

        # 検出結果テキスト
        ctk.CTkLabel(right, text="検出結果",
                     font=ctk.CTkFont(size=13, weight="bold")).grid(
            row=5, column=0, pady=(8,2))
        self._info = ctk.CTkTextbox(right, font=ctk.CTkFont(family="Courier New", size=10),
                                    state="disabled")
        self._info.grid(row=6, column=0, sticky="nsew", padx=10, pady=(0,10))

        # ─ ステータス・プログレス
        self._prog = ctk.CTkProgressBar(self, mode="determinate")
        self._prog.set(0)
        self._prog.grid(row=1, column=0, columnspan=3, sticky="ew", padx=8, pady=(2,0))

        self._status_var = tk.StringVar()
        status = ctk.CTkLabel(self, textvariable=self._status_var,
                               anchor="w", font=ctk.CTkFont(size=11))
        status.grid(row=2, column=0, columnspan=3, sticky="ew", padx=12, pady=(2,6))

    def _build_params(self, parent):
        parent.grid_columnconfigure(1, weight=1)

        def row(r, label, var, kind, **kw):
            ctk.CTkLabel(parent, text=label, anchor="w").grid(
                row=r, column=0, sticky="w", padx=(10,4), pady=3)
            if kind == "entry":
                w = ctk.CTkEntry(parent, textvariable=var, width=90)
            elif kind == "slider":
                lo, hi = kw.get("from_",0), kw.get("to",100)
                w = ctk.CTkSlider(parent, from_=lo, to=hi, variable=var, width=100)
            elif kind == "spin":
                # CTkSpinBox なし → OptionMenu で代用
                vals = [str(i) for i in range(1,9)]
                def _set(v, v2=var): v2.set(int(v))
                w = ctk.CTkOptionMenu(parent, values=vals,
                                      command=_set, width=90)
                w.set(str(int(var.get())))
            w.grid(row=r, column=1, sticky="ew", padx=(0,10), pady=3)

        self._p_cyl_d   = tk.DoubleVar(value=30.0)
        self._p_theta   = tk.DoubleVar(value=68.0)
        self._p_ncones  = tk.IntVar(value=4)
        self._p_cyl_p2  = tk.IntVar(value=30)
        self._p_cone_p2 = tk.IntVar(value=20)
        self._p_minr    = tk.DoubleVar(value=0.01)
        self._p_maxr    = tk.DoubleVar(value=0.25)

        row(0, "円柱直径 (mm)",  self._p_cyl_d,  "entry")
        row(1, "円錐半角 θ (°)", self._p_theta,  "entry")
        row(2, "円錐数",         self._p_ncones, "spin")

        ctk.CTkLabel(parent, text="─── 検出感度 ───",
                     font=ctk.CTkFont(size=10), text_color="gray").grid(
            row=3, column=0, columnspan=2, pady=(6,2))

        row(4, "円柱感度",  self._p_cyl_p2,  "slider", from_=10, to=60)
        row(5, "円錐感度",  self._p_cone_p2, "slider", from_=5,  to=50)
        row(6, "最小半径比", self._p_minr,   "entry")
        row(7, "最大半径比", self._p_maxr,   "entry")

    def _get_params(self) -> dict:
        return {
            "cylinder_diameter_mm": self._p_cyl_d.get(),
            "cone_angle_deg":       self._p_theta.get(),
            "n_cones":              self._p_ncones.get(),
            "cyl_param2":           int(self._p_cyl_p2.get()),
            "cone_param2":          int(self._p_cone_p2.get()),
            "cone_min_r_ratio":     self._p_minr.get(),
            "cone_max_r_ratio":     self._p_maxr.get(),
        }

    # ─── 検出メソッド切り替え ──────────────────────────────────

    def _set_method(self, method: str):
        self._method_var.set(method)
        active   = {"fg_color": "#1a6fb5",  "hover_color": "#1558a0"}
        inactive = {"fg_color": "#555555",  "hover_color": "#666666"}
        if method == "hough":
            self._btn_hough.configure(**active)
            self._btn_mec.configure(**inactive)
        else:
            self._btn_hough.configure(**inactive)
            self._btn_mec.configure(**active)

    # ─── 確定パネル ────────────────────────────────────────────

    def _build_lock_panel(self, parent):
        parent.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(parent, text="確定管理",
                     font=ctk.CTkFont(size=11, weight="bold"),
                     anchor="w").grid(row=0, column=0, columnspan=2,
                                      sticky="w", padx=8, pady=(6, 2))
        self._lock_btns = {}
        items = [("cylinder", "■ 円柱")] + [(f"cone_{i}", f"● C{i}") for i in range(4)]
        for row_i, (key, label) in enumerate(items, start=1):
            ctk.CTkLabel(parent, text=label, anchor="w",
                         font=ctk.CTkFont(size=10)).grid(
                row=row_i, column=0, sticky="w", padx=(8, 4), pady=1)
            btn = ctk.CTkButton(
                parent, text="確定", width=60, height=24,
                fg_color="#555555", hover_color="#666666",
                font=ctk.CTkFont(size=10),
                command=lambda k=key: self._toggle_lock(k))
            btn.grid(row=row_i, column=1, sticky="e", padx=(0, 8), pady=1)
            self._lock_btns[key] = btn

    def _toggle_lock(self, key: str):
        idx = self.current_index
        if idx < 0:
            return
        if idx not in self._locked:
            self._locked[idx] = {"cylinder": None, "cones": [None] * 4}
        locked = self._locked[idx]

        if key == "cylinder":
            if locked["cylinder"] is not None:
                locked["cylinder"] = None          # 解除
            else:
                locked["cylinder"] = self._canvas.get_cylinder()
        else:
            ci = int(key.split("_")[1])
            if locked["cones"][ci] is not None:
                locked["cones"][ci] = None         # 解除
            else:
                cones = self._canvas.get_cones()
                locked["cones"][ci] = cones[ci] if ci < len(cones) else None

        self._update_lock_panel()
        self._canvas.set_circles(
            self._canvas.get_cylinder() if idx not in self.results
            else self.results[idx].get("cylinder"),
            self._canvas.get_cones() if idx not in self.results
            else self.results[idx].get("cones", []),
            *self._locked_flags(idx))

    def _locked_flags(self, idx):
        """(locked_cyl: bool, locked_cones: list[bool]) を返す。"""
        locked = self._locked.get(idx, {"cylinder": None, "cones": [None] * 4})
        cyl_flag   = locked.get("cylinder") is not None
        cone_flags = [locked.get("cones", [None]*4)[i] is not None for i in range(4)]
        return cyl_flag, cone_flags

    def _update_lock_panel(self):
        if not hasattr(self, "_lock_btns"):
            return
        idx    = self.current_index
        locked = self._locked.get(idx, {"cylinder": None, "cones": [None] * 4})
        cones_on_canvas = self._canvas.get_cones() if idx >= 0 else []
        cyl_on_canvas   = self._canvas.get_cylinder() if idx >= 0 else None

        def _cfg(key, is_locked, has_circle):
            btn = self._lock_btns.get(key)
            if btn is None:
                return
            btn.configure(
                state ="normal" if (has_circle or is_locked) else "disabled",
                text  ="解除" if is_locked else "確定",
                fg_color    ="#2d7a2d" if is_locked else "#555555",
                hover_color ="#3d8a3d" if is_locked else "#666666",
            )

        _cfg("cylinder", locked.get("cylinder") is not None, cyl_on_canvas is not None)
        lc = locked.get("cones", [None] * 4)
        for i in range(4):
            _cfg(f"cone_{i}", lc[i] is not None, i < len(cones_on_canvas))

    # ─── ステータス ────────────────────────────────────────────

    def _set_status(self, msg):
        self._status_var.set(msg)
        self.update_idletasks()

    # ─── ファイル ─────────────────────────────────────────────

    def _open_folder(self):
        folder = filedialog.askdirectory(title="画像フォルダを選択")
        if not folder:
            return
        exts = {".png",".jpg",".jpeg",".bmp",".tiff",".tif"}
        paths = sorted(str(p) for p in Path(folder).iterdir()
                       if p.suffix.lower() in exts)
        if not paths:
            messagebox.showwarning("警告", "対応する画像ファイルが見つかりません")
            return
        self.image_paths = paths
        self.results = {}
        self.current_index = -1
        self._listbox.delete(0, "end")
        for p in paths:
            self._listbox.insert("end", Path(p).name)
        self._set_status(f"{len(paths)} 枚の画像を読み込みました")
        self._listbox.selection_set(0)
        self._load_image(0)

    def _load_image(self, idx):
        if idx < 0 or idx >= len(self.image_paths):
            return
        self.current_index = idx
        path = self.image_paths[idx]
        self._cv_img = _imread(path)
        if self._cv_img is None:
            self._set_status(f"読み込み失敗: {path}")
            return
        rgb = cv2.cvtColor(self._cv_img, cv2.COLOR_BGR2RGB)
        self._canvas.set_image(Image.fromarray(rgb))
        if idx in self.results:
            r = self.results[idx]
            lf = self._locked_flags(idx)
            self._canvas.set_circles(r.get("cylinder"), r.get("cones", []), *lf)
            self._update_info(idx)
        else:
            self._canvas.set_circles(None, [])
        self._update_lock_panel()
        self._set_status(
            f"[{idx+1}/{len(self.image_paths)}] {Path(path).name}"
            + ("  ✓解析済" if idx in self.results else ""))

    def _on_select(self, _):
        sel = self._listbox.curselection()
        if sel:
            self._load_image(sel[0])

    # ─── 解析 ─────────────────────────────────────────────────

    def _analyze_current(self):
        if self.current_index < 0 or self._cv_img is None:
            messagebox.showwarning("警告", "画像を選択してください")
            return
        threading.Thread(target=self._run_analysis,
                         args=([self.current_index],), daemon=True).start()

    def _analyze_all(self):
        if not self.image_paths:
            messagebox.showwarning("警告", "フォルダを開いてください")
            return
        if self._analyzing:
            return
        threading.Thread(target=self._run_analysis,
                         args=(list(range(len(self.image_paths))),),
                         daemon=True).start()

    def _run_analysis(self, indices):
        self._analyzing = True
        params = self._get_params()
        total  = len(indices)
        STEPS  = ["前処理", "円柱検出", "円錐検出", "輪郭検出"]
        N_STEPS = len(STEPS)

        for i, idx in enumerate(indices):
            path = self.image_paths[idx]
            name = Path(path).name
            self.after(0, lambda m=f"解析中 [{i+1}/{total}]: {name}":
                       self._set_status(m))
            self.after(0, lambda v=(i * N_STEPS) / (total * N_STEPS):
                       self._prog.set(v))

            img = _imread(path)
            if img is None:
                continue

            def _on_step(msg, _i=i, _name=name):
                step_idx = STEPS.index(msg) if msg in STEPS else 0
                frac = (_i * N_STEPS + step_idx) / (total * N_STEPS)
                status = f"解析中 [{_i+1}/{total}]  {msg}中...  {_name}"
                self.after(0, lambda f=frac: self._prog.set(f))
                self.after(0, lambda m=status: self._set_status(m))

            ap = {
                "n_cones":          int(params["n_cones"]),
                "cyl_param2":       params["cyl_param2"],
                "cone_param2":      params["cone_param2"],
                "cone_min_r_ratio": params["cone_min_r_ratio"],
                "cone_max_r_ratio": params["cone_max_r_ratio"],
            }
            if self._method_var.get() == "mec":
                result = analyze_image_mec(img, ap, progress=_on_step)
            else:
                result = analyze_image(img, ap, progress=_on_step)

            # ── 確定済み円を保護してマージ
            result = self._merge_locked(idx, result)

            result.update(image_path=path, params=params)
            result = self._compute_3d(result, params)
            self.results[idx] = result

            def _ui_update(r=result, i2=idx):
                if i2 == self.current_index:
                    lf = self._locked_flags(i2)
                    self._canvas.set_circles(r.get("cylinder"), r.get("cones", []), *lf)
                    self._update_info(i2)
                    self.after(0, self._update_lock_panel)
                ok = r.get("plane") is not None
                self._listbox.itemconfig(i2, {"fg": "#55cc55" if ok else "#cc5555"})
            self.after(0, _ui_update)

        self.after(0, lambda: self._prog.set(0))
        self.after(0, lambda: self._set_status(f"解析完了: {total} 枚"))
        self._analyzing = False

    # ─── 3D 計算 ──────────────────────────────────────────────

    def _compute_3d(self, result, params):
        cyl     = result.get("cylinder")
        cones   = result.get("cones", [])
        contour = result.get("contour", [])

        if cyl is None:
            result.update(plane=None, cones_3d=[], contour_3d=[], mm_per_px=1.0)
            return result

        cx_px, cy_px, cr_px = cyl
        mpp = compute_mm_per_px(cr_px, params["cylinder_diameter_mm"])
        ang = params["cone_angle_deg"]
        result["mm_per_px"] = mpp

        pts3d, c3d_list = [], []
        for c in cones:
            xp, yp, rp = c[0], c[1], c[2]
            xm = (xp-cx_px)*mpp;  ym = (yp-cy_px)*mpp
            rm = rp*mpp;           h  = cone_height(rm, ang)
            pts3d.append([xm, ym, h])
            c3d_list.append({
                "center_2d_px":  [int(xp), int(yp)],
                "radius_px":     int(rp),
                "center_2d_mm":  [round(xm,4), round(ym,4)],
                "radius_mm":     round(rm,4),
                "height_mm":     round(h,4),
            })

        plane_abcd = None
        if len(pts3d) >= 3:
            plane_abcd = fit_plane(pts3d)
            a,b,c_n,_ = plane_abcd
            nl = (a**2+b**2+c_n**2)**0.5
            normal = [a/nl,b/nl,c_n/nl] if nl>0 else [0,0,1]
            for pt, c3d in zip(pts3d, c3d_list):
                z = z_from_plane(pt[0], pt[1], plane_abcd)
                c3d["point_on_plane"] = [round(pt[0],4), round(pt[1],4), round(z,4)]
            result["plane"] = {"abcd":[round(v,6) for v in plane_abcd],
                                "normal":[round(v,6) for v in normal]}
        else:
            result["plane"] = None

        result["cones_3d"] = c3d_list
        if plane_abcd and contour:
            result["contour_3d"] = points_to_3d(contour, plane_abcd, cx_px, cy_px, mpp)
        else:
            result["contour_3d"] = []
        return result

    # ─── 確定済み円のマージ ────────────────────────────────────

    def _merge_locked(self, idx: int, result: dict) -> dict:
        """
        解析結果に確定済み円をマージする。
          - 確定済み円柱: result の cylinder を上書き
          - 確定済み円錐: そのインデックスに上書き、残りスロットに新検出を充填
        """
        locked = self._locked.get(idx)
        if not locked:
            return result

        # 円柱
        if locked.get("cylinder") is not None:
            result["cylinder"] = locked["cylinder"]

        # 円錐
        locked_cones = locked.get("cones", [None] * 4)
        confirmed    = [c for c in locked_cones if c is not None]
        new_detected = result.get("cones", [])

        # 確定済み円錐と重なる新検出を除去
        def _overlaps(nc, confirmed_list):
            for cc in confirmed_list:
                d = ((nc[0]-cc[0])**2 + (nc[1]-cc[1])**2) ** 0.5
                if d < (nc[2] + cc[2]) * 0.5:
                    return True
            return False

        filtered = [nc for nc in new_detected if not _overlaps(nc, confirmed)]

        # 各スロットを確定済みで埋め、空きに新検出を充填
        final = list(locked_cones)  # [value|None, ...]
        fi = 0
        for i in range(len(final)):
            if final[i] is None and fi < len(filtered):
                final[i] = filtered[fi]
                fi += 1

        result["cones"] = [c for c in final if c is not None]
        return result

    # ─── UI 更新 ──────────────────────────────────────────────

    def _update_info(self, idx):
        if idx not in self.results:
            return
        r = self.results[idx]
        lines = []
        cyl = r.get("cylinder")
        if cyl:
            mpp = r.get("mm_per_px", 0)
            lines += [f"■ 円柱",
                      f"  中心: ({cyl[0]}, {cyl[1]}) px",
                      f"  半径: {cyl[2]} px",
                      f"  {mpp:.5f} mm/px", ""]
        else:
            lines += ["■ 円柱: 未検出", ""]

        c3d = r.get("cones_3d", [])
        lines.append(f"■ 円錐: {len(c3d)} 個")
        for i, c in enumerate(c3d):
            lines.append(f"  C{i}: r={c['radius_px']}px"
                         f"  h={c['height_mm']:.3f}mm")

        pln = r.get("plane")
        if pln:
            n = pln["normal"]
            lines += ["", "■ 断面平面",
                      f"  法線 ({n[0]:.3f}, {n[1]:.3f}, {n[2]:.3f})"]
        else:
            lines += ["", "■ 平面: 推定不可(円錐≥3必要)"]

        ct = r.get("contour_3d", [])
        if ct:
            lines.append(f"\n■ 輪郭: {len(ct)} 点")

        self._info.configure(state="normal")
        self._info.delete("1.0", "end")
        self._info.insert("end", "\n".join(lines))
        self._info.configure(state="disabled")

    def _on_circles_changed(self):
        if self.current_index < 0 or self._cv_img is None:
            return
        idx = self.current_index
        params = self._get_params()
        cyl   = self._canvas.get_cylinder()
        cones = self._canvas.get_cones()
        if idx not in self.results:
            self.results[idx] = {}
        r = self.results[idx]
        r.update(cylinder=cyl, cones=cones,
                 image_path=self.image_paths[idx], params=params)
        if cyl:
            from analyzer import detect_contour
            r["contour"] = detect_contour(self._cv_img, cyl)
        self.results[idx] = self._compute_3d(r, params)
        self._update_info(idx)

        # 確定済み円をドラッグ後の位置に追従させる
        if idx in self._locked:
            lk = self._locked[idx]
            if lk.get("cylinder") is not None and cyl:
                lk["cylinder"] = cyl
            lc = lk.get("cones", [None] * 4)
            for i in range(len(lc)):
                if lc[i] is not None and i < len(cones):
                    lc[i] = cones[i]
        self._update_lock_panel()

    # ─── エクスポート ──────────────────────────────────────────

    def _export_json(self):
        if not self.results:
            messagebox.showwarning("警告", "解析結果がありません")
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON","*.json"),("全ファイル","*.*")],
            title="JSON 保存先")
        if not path:
            return

        params = self._get_params()
        output = {"global":{"cylinder_diameter_mm":params["cylinder_diameter_mm"],
                             "cone_angle_deg":params["cone_angle_deg"]},
                  "slices":[]}

        for idx in sorted(self.results.keys()):
            r   = self.results[idx]
            _ = r.get("cylinder")
            pln = r.get("plane")
            cs  = r.get("cones", [])
            c3  = r.get("cones_3d", [])
            cones_out = []
            for cpx, c3d in zip(cs, c3):
                e = {"center_2d":[int(cpx[0]),int(cpx[1])],
                     "radius_px":int(cpx[2]),
                     "center_2d_mm":c3d.get("center_2d_mm",[]),
                     "radius_mm":c3d.get("radius_mm",0),
                     "height_mm":c3d.get("height_mm",0)}
                if "point_on_plane" in c3d:
                    e["apex_3d"] = c3d["point_on_plane"]
                cones_out.append(e)

            output["slices"].append({
                "index":      idx,
                "image_path": Path(r.get("image_path","")).name,
                "mm_per_px":  r.get("mm_per_px",0),
                "plane":      {"normal":pln["normal"],"abcd":pln["abcd"]} if pln else None,
                "cones":      cones_out,
                "contour":    r.get("contour_3d",[]),
                "cracks":     r.get("cracks_3d",[]),
                "lme":        r.get("lme_3d",[]),
            })

        with open(path,"w",encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        self._set_status(f"JSON 保存: {path}")
        messagebox.showinfo("完了", f"保存しました:\n{path}")

    # ─── 3D 表示 ──────────────────────────────────────────────

    def _show_3d(self):
        if not self.results:
            messagebox.showwarning("警告", "解析結果がありません")
            return
        threading.Thread(target=self._launch_3d, daemon=True).start()

    def _launch_3d(self):
        try:
            visualize_3d(self.results)
        except Exception as e:
            self.after(0, lambda: messagebox.showerror(
                "3D エラー", f"{e}\n\npip install open3d"))

    # ─── メニューバー ─────────────────────────────────────────

    def _make_menu(self):
        mb = tk.Menu(self)
        self.configure(menu=mb)
        fm = tk.Menu(mb, tearoff=False)
        mb.add_cascade(label="ファイル", menu=fm)
        fm.add_command(label="フォルダを開く (Ctrl+O)", command=self._open_folder)
        fm.add_separator()
        fm.add_command(label="JSON エクスポート", command=self._export_json)
        fm.add_separator()
        fm.add_command(label="終了", command=self.quit)
        self.bind("<Control-o>", lambda _: self._open_folder())
        self.bind("<Control-s>", lambda _: self._export_json())


# ════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app = App()
    app._make_menu()

    # ツールバーにフォルダボタンを追加
    tb = ctk.CTkFrame(app, height=44, corner_radius=0, fg_color="#1a1a2e")
    tb.grid(row=0, column=0, columnspan=3, sticky="ew")
    tb.grid_propagate(False)
    ctk.CTkButton(tb, text="📂 フォルダを開く", width=160, height=32,
                  command=app._open_folder).pack(side="left", padx=8, pady=6)
    ctk.CTkLabel(tb, text="断面画像解析・3D再構築ツール",
                 font=ctk.CTkFont(size=15, weight="bold"),
                 text_color="#aaaacc").pack(side="left", padx=20)

    # ツールバー分だけ行をずらす
    app.grid_rowconfigure(0, weight=0, minsize=44)
    app.grid_rowconfigure(1, weight=1)
    app.grid_rowconfigure(2, weight=0)
    app.grid_rowconfigure(3, weight=0)

    app._canvas.grid(row=1, column=1, sticky="nsew", padx=4, pady=4)

    # 左・右パネルも行1に
    for w in app.grid_slaves():
        info = w.grid_info()
        if info.get("row") == 0 and w is not tb:
            w.grid(row=1, **{k:v for k,v in info.items() if k!="row"})

    app._prog.grid(row=2, column=0, columnspan=3, sticky="ew", padx=8, pady=(2,0))
    for w in app.grid_slaves():
        info = w.grid_info()
        if info.get("row") == 2 and w is not app._prog:
            w.grid(row=3, **{k:v for k,v in info.items() if k!="row"})

    app.mainloop()
