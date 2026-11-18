---
name: dodit-design
description: Sistem desain DoD IT (Erahajj) — alat operasional internal yang bersih, datar, berbasis Poppins dan biru navy. Gunakan setiap kali membuat atau mengubah UI (halaman, form, tabel, modal, toast, tombol) agar konsisten dengan DoD IT, baik di versi PHP + Bootstrap maupun versi Go + React/Tailwind.
---

# Skill Desain DoD IT (Erahajj)

Diekspor dari project `erahajj-dod` pada 2026-11-18. Sumber kebenaran:

| Implementasi | Berkas | Status |
|---|---|---|
| **go-dod** (React 19 + Vite + Tailwind v4 + Motion + Radix) | `go-dod/web/src/index.css`, `go-dod/web/src/components/**` | **Acuan utama.** Mendukung tema gelap. |
| PHP lama (Bootstrap 5 + skin) | `src/public/assets/css/app.css`, `dodit-design.css`, `src/views/*.php` | Warisan; tema terang saja. Token sama. |

Aturan emas: **kalau dua sumber berbeda, ikuti go-dod.** Bagian "Pemetaan Bootstrap" di akhir untuk yang masih menyentuh PHP.

---

## 1. Karakter visual

Alat kerja operator, bukan halaman pemasaran. Tenang, padat informasi, mudah dipindai.

1. **Datar.** Kartu, tabel, input, dan toast tidak memakai bayangan. Garis 1px `--line` yang memisahkan. Bayangan (`--shadow`) hanya untuk yang *melayang*: modal, dropdown, command palette, kartu login.
2. **Bulat konsisten.** Tombol & badge = pil penuh (`rounded-full`). Input & kotak pilihan = 10px. Kartu kecil/stat = 14px. Kartu & tabel = 16px. Modal = 16px (`rounded-2xl`). Kartu login = 20px.
3. **Satu warna aksi:** biru Erahajj (`--brand`). Cyan (`--cyan`) hanya untuk cincin fokus, seleksi teks, dan aksen halus. Merah/hijau/kuning hanya untuk status.
4. **Judul ringan, kata kunci tebal.** `h1` berbobot 400 dengan satu frasa kunci ditebalkan dan berwarna brand: `Ringkasan <b>pekerjaan</b>`.
5. **Gerak halus, bermakna, dan boleh dimatikan.** Semua gerak menghormati `prefers-reduced-motion`.
6. **Bahasa Indonesia**, nada singkat dan langsung ("Geser untuk mengirim", "Tahan untuk menghapus", "Semua task sudah selesai").

---

## 2. Token warna

Definisikan sebagai CSS variable di `:root`, timpa di `[data-theme='dark']`. Jangan pernah menulis hex mentah di komponen; selalu lewat token.

| Token | Terang | Gelap | Dipakai untuk |
|---|---|---|---|
| `--bg` | `#edf4f9` | `#0b1722` | Latar halaman |
| `--surface` | `#ffffff` | `#12202e` | Kartu, topbar, input, modal |
| `--surface2` | `#f4f8fb` | `#172a3b` | Header tabel, hover baris, field read-only, track, panel ringan |
| `--ink` | `#123049` | `#e6eef5` | Teks utama (navy Erahajj) |
| `--ink2` | `#4a5f73` | `#9fb3c6` | Teks sekunder, label kecil, ikon |
| `--line` | `#d3e1ec` | `#243a4e` | Semua garis & border |
| `--brand` | `#105092` | `#5aa2e8` | Tombol utama, tautan, tab aktif, progres |
| `--brand-ink` | `#ffffff` | `#06192b` | Teks di atas `--brand` |
| `--brand-soft` | `#e3eef8` | `#14304a` | Latar aktif/terpilih, badge info, nav aktif |
| `--cyan` | `#02acdf` | `#2cc4f0` | Cincin fokus, seleksi |
| `--ok` / `--ok-bg` | `#166d3f` / `#ddf2e6` | `#5fd08f` / `#123524` | Sukses, Done, Publish, Aktif |
| `--warn` / `--warn-bg` | `#7a4e06` / `#fdf1dc` | `#f0c36a` / `#3a2c0e` | Perlu perhatian, In Review |
| `--bad` / `--bad-bg` | `#b3261e` / `#fbe3e1` | `#ff8a80` / `#421a17` | Galat, destruktif, Suspend, terlambat |
| `--track` | `#dce8f1` | `#223a50` | Rel progres, switch mati |

Identitas merek: navy `#123049`, biru `#105092`, cyan `#02ACDF`.

**Pemetaan status → warna** (`badge.tsx`):

| Status | Nada |
|---|---|
| Done, Publish, Aktif | `ok` |
| Suspend, Unpublish | `bad` |
| In Progress | `brand` |
| In Review | `warn` |
| lainnya | `mute` (`surface2` + border `line`) |

**Kontras wajib** WCAG AA: 4.5:1 teks biasa, 3:1 teks besar (≥24px, atau ≥18.66px tebal). Diuji otomatis di terang & gelap. Itu sebabnya `--ok` terang digelapkan jadi `#166d3f` (versi PHP lama `#1B7F4B` terlalu terang).

Tema gelap: atribut `data-theme="dark"` di `<html>`, dipasang **sebelum render** oleh `public/theme-init.js` (tanpa inline script karena CSP). Pilihan `light | dark | system`, disimpan di `localStorage['dod-theme']`.

---

## 3. Tipografi

- **Poppins** lokal (400, 500, 600, 700, `font-display: swap`), tanpa CDN. Fallback: `system-ui, -apple-system, 'Segoe UI', sans-serif`.
- Dasar **14px / 1.55**, `-webkit-font-smoothing: antialiased`.
- Angka di tabel, statistik, dan pager: `font-variant-numeric: tabular-nums` (kelas `.num`).

| Peran | Ukuran / bobot |
|---|---|
| `h1` halaman | 28px / 400, line-height 1.2 (24px di <760px) |
| `h1` login | 24px / 700 |
| `h2` bagian & judul modal | 18px / 600 |
| `h3` | 15px / 600 |
| Eyebrow | 11px / 600, UPPERCASE, `tracking-[0.09em]`, `--ink2` |
| Teks bantu / deskripsi | 12–13px, `--ink2` (deskripsi halaman maks. `70ch`) |
| Label form | 12.5px / 600, `--ink` |
| Isi tabel | 13px; header 12px / 600 `--ink2` |
| Angka statistik | 30px (`text-3xl`) / 700 |
| Badge | 12px / 500 |

---

## 4. Ruang, grid, layout

- Konten maks. **1240px**, padding `px-4 sm:px-6`, `py-7 pb-14`.
- **App shell:** sidebar 260px (sticky, `lg:` ke atas) + topbar 60px sticky (`bg-surface/85 backdrop-blur`, border bawah). Di bawah `lg`, sidebar jadi drawer geser 288px dengan overlay `#06121c/55`.
- Kartu statistik: `grid-cols-1 sm:2 lg:3 xl:4`, `gap-3`.
- Form: **satu kolom** untuk alur tambah (wizard); `sm:grid-cols-2` hanya di dialog ubah.
- Portal publik (Taskit): satu kolom sempit **560px**, header 56px.
- Jarak antar field `gap-4`; antar bagian `mb-5` / `mb-6`.
- Breakpoint uji: **390 / 768 / 1280px**. Tidak boleh ada gulir horizontal halaman; di 1280px tabel harus muat tanpa gulir.

---

## 5. Komponen

### Tombol (`button.tsx`)
Pil penuh, `font-semibold`, ikon + label `gap-2`. Ukuran: `sm` (12px, `px-3 py-1.5`), `md` (13px, `px-[18px] py-2.5`), `icon` (36px bulat).

| Varian | Tampilan |
|---|---|
| `primary` | `bg-brand text-brand-ink`, hover `brightness-110` |
| `outline` | border `line`, hover: border & teks `brand`, latar `surface2` |
| `soft` | `bg-brand-soft text-brand` |
| `ghost` | teks `ink2`, hover `surface2` |
| `danger` | border `line`, teks `bad`, hover border `bad` + `bad-bg` |

Gerak: hover naik 1px, tap `scale .96`, spring `stiffness 500 / damping 30`. `loading` menampilkan spinner dan menonaktifkan tombol. `disabled` = opacity .5.

### Input, Select, Textarea (`fields.tsx`)
- **Tinggi seragam `h-11` (44px)** untuk semua kontrol; radius 10px; padding `px-3`; font 14px (16px di mobile agar iOS tidak zoom).
- Fokus: border `brand` + ring `3px cyan/35`.
- Read-only: latar `surface2`. Disabled: opacity .6.
- Select: `appearance-none` + chevron kustom di kanan (`pr-9`).
- Textarea: mulai 44px, tumbuh otomatis sampai ±150px.
- **`Field`**: label di atas (12.5px/600), tanda wajib `*` merah (`aria-hidden`), "(opsional)" abu-abu, petunjuk 12px di bawah. `id` dibagikan lewat render-prop supaya label ↔ kontrol terhubung, `aria-describedby` ke petunjuk.
- **`CheckRow`**: kotak 10px berborder, `min-h-11`, hover border `brand`, **terpilih = border `brand` + latar `brand-soft`**. Checkbox native dengan `accent-color: var(--brand)`.
- Galat inline: `rounded-[10px] bg-bad-bg text-bad`, `role="alert"`, 13px.

### Kartu & statistik
- `Card`: `rounded-card (16px) border border-line bg-surface`. Tanpa bayangan.
- Stat: `rounded-[14px]`, padding 16px; label `ink2`, angka 30px/700, **`CountUp`** (hitung naik 0,9 dtk), `ProgressBar` 6px (`bg-track`, isi `bg-brand`, animasi lebar 0,9 dtk). Kartu yang bisa diklik: hover border `brand` + naik 2–3px. Skeleton saat memuat: `animate-pulse bg-surface2` bertinggi sama.
- Warna angka: `ok` untuk selesai, `warn` untuk tertunda; selain itu `ink`.

### Tabel (`misc.tsx`)
- Dibungkus `Card overflow-hidden`; header kartu: judul `h2` kiri, keterangan `ink2` kanan.
- `th`: 12px/600 `ink2`, `scope="col"`, rata kiri, `px-4 py-3`. Kolom bisa diurut → `SortTh` (tombol + ikon ArrowUpDown/Up/Down, `aria-sort`).
- Baris: `border-t border-line`, hover `surface2`, **masuk bergantian** (stagger 30ms, maks. 12 baris, naik 6px + fade).
- Umur/terlambat: teks `bad` tebal + ikon segitiga peringatan.
- `Pager`: info "N data · halaman X dari Y" kiri; tombol bulat 32px kanan, halaman aktif `bg-brand text-brand-ink`, elipsis untuk rentang panjang, `aria-current="page"`.
- **Mobile (<760px):** tabel berubah jadi kartu bertumpuk (label kolom kecil UPPERCASE di kiri nilai).
- Keadaan kosong → `EmptyState`.

### Filter bar
Satu baris yang membungkus: kotak cari (ikon kaca pembesar di kiri, `min-w-52 flex-1`, debounce) + `FilterSelect` (opsi pertama = nama filter) + `PerPage` (15/25/50) + tombol **Reset** (ghost, muncul hanya jika ada filter aktif). Filter disimpan di URL query.

### Badge
Pil `px-2.5 py-0.5`, 12px/500, warna `tone` (lihat pemetaan status). Badge platform memakai `brand`.

### Modal (`modal.tsx`, Radix Dialog)
Overlay `#06121c/55` + `backdrop-blur-[2px]`; panel `rounded-2xl border bg-surface shadow-card`, lebar `max-w-lg|2xl|4xl`; header (judul 18px/600 + deskripsi opsional + tombol tutup bulat 32px) dipisah garis dari isi yang bisa digulir (`scroll-thin`). Masuk: spring dari `y:24 scale:.97`; keluar cepat. Klik overlay menutup kecuali `dismissible={false}`. Judul & deskripsi wajib ada (deskripsi `sr-only` bila kosong).

### Toast (`sonner`)
Kanan-bawah, `richColors`, `closeButton`, mengikuti tema, font Poppins. Sukses 3 dtk (default), galat/peringatan 8 dtk. Untuk proses panjang (kirim ke Telegram) pakai **`toast.promise`** dengan teks *loading → sukses/gagal*. (Versi PHP lama: kanan-atas di bawah topbar, kartu netral dengan titik warna 7px per jenis.)

### Alur bertahap / Wizard (`wizard.tsx`)
- Header: "Langkah N **dari M**" (tambah `+` bila pencabang belum dijawab) + deretan segmen progres setinggi 6px (`bg-track`, isi `bg-brand`).
- **Maks. 3 isian per langkah**, dan langkah *ditutup* setelah isian pencabang (yang memengaruhi isian lain) supaya turunan muncul di langkah berikutnya.
- Tiap langkah adalah `<form>`: validasi bawaan browser berjalan per langkah, **Enter = Lanjut**.
- Transisi: geser 28px + fade 0,2 dtk sesuai arah. Fokus otomatis ke field pertama langkah baru.
- Tombol **Kembali (ghost) + Lanjut/Kirim (primary) berdampingan di kanan**; kursor tak perlu berpindah jauh.
- Langkah terakhir untuk portal = "Periksa" (daftar `dl` ringkasan dengan `divide-y`) + Slide-to-Confirm.
- Beri padding 8px di pembungkus overflow agar cincin fokus tidak terpotong.

### Aksi berisiko — jangan pakai `confirm()` / dialog "Yakin?"
- **`HoldButton`** untuk hapus: tombol pil kecil teks `bad`, **tahan ±0,9 dtk** hingga latar `bad/20` mengisi penuh; lepas sebelum penuh = batal; label berubah "Tahan…"; mendukung keyboard (tahan Enter/Spasi); `aria-label`/`title` menjelaskan.
- **`SlideConfirm`** untuk kirim: trek 56px (`bg-surface2`, border `line`), pegangan bulat 46px `bg-brand` dengan celah 4px, isi berubah `brand-soft` mengikuti geser, label memudar. **Lolos di ≥90%**; kurang dari itu kembali dengan spring. `role="slider"`, alternatif keyboard Enter/Spasi/→. Status: panah → spinner → centang.

### Navigasi
- Sidebar: logo 32px + "DoD IT" (20px/700 `brand`) + subjudul 11px `ink2`. Item `rounded-[10px]`, 12.5px/500; aktif = teks `brand` di atas **pil `brand-soft` yang bergeser antar item** (`layoutId`, spring). Bagian bisa dilipat (Task, Laporan) dengan chevron berputar dan submenu bergaris kiri.
- Topbar: breadcrumb "DoD ERAHAJJ / {judul halaman}" 12px, tombol "Cari & lompat" (`/` dan `⌘K`), pemilih tema, menu pengguna (avatar bulat 32px `bg-brand`).
- **Command palette** (`cmdk`): grup Halaman / Task / Laporan / Travel / Aksi; item terpilih `bg-brand-soft text-brand`; footer petunjuk keyboard.
- Tautan "Langsung ke konten" (skip link) wajib ada.

### Lainnya
- `Switch` (Radix): 44×24, mati `bg-track`, nyala `bg-brand`, kenop putih 20px.
- `EmptyState`: ikon Inbox dalam lingkaran 48px `brand-soft` yang melayang pelan, judul tebal, teks `ink2` maks. `sm`, opsi aksi.
- Splash pemuatan: spinner 32px (`border-line border-t-brand`).
- Halaman login: kartu 400px tengah layar, dua bola blur `cyan/20` dan `brand/20` melayang di latar, logo 52px, eyebrow, judul "Selamat datang kembali", galat bergetar.
- Portal publik: header dengan chip "ERAHAJJ" (`brand-soft`, 10px, tracking lebar).

---

## 6. Gerak

Pustaka tunggal: **Motion** (`motion/react`). Jangan menambah anime.js atau pustaka animasi kedua. Bungkus aplikasi dengan `<MotionConfig reducedMotion="user">`; tambah juga aturan CSS global yang menekan `transition/animation-duration` ke 0,01ms saat `prefers-reduced-motion: reduce`.

| Pola | Parameter |
|---|---|
| Transisi halaman | fade + `y 10→0`, 0,18 dtk, `AnimatePresence mode="wait"` |
| Header halaman | fade + `y 8→0` |
| Kartu stat masuk | `y 14→0`, delay `i × 0.04` |
| Baris tabel | `y 6→0`, delay `min(i,12) × 0.03`, 0,25 dtk |
| Tombol | hover `y -1`, tap `scale .96`, spring 500/30 |
| Modal / palette | spring 380–420 / damping 32, dari `y` kecil + `scale .97` |
| Drawer | `x -100% → 0`, spring 380/36 |
| Wizard antar langkah | geser ±28px, 0,2 dtk |
| Hitung naik / progres | 0,9 dtk `easeOut` |
| Easing CSS (versi PHP) | `cubic-bezier(.2,.7,.2,1)`, 0,18 dtk |

Aturan: gerak harus menjelaskan perubahan (masuk, keluar, status), bukan sekadar hiasan. Satu-satunya animasi berulang yang diizinkan: pelampung EmptyState dan bola latar login.

---

## 7. Aksesibilitas (diuji otomatis)

Playwright `e2e/05-audit-ui.spec.ts` + `audit-lib.ts` mengaudit di 390/768/1280px, terang & gelap:

1. **Cincin fokus tidak terpotong** oleh ancestor ber-`overflow` (Tab menyusuri semua kontrol).
2. **Tidak ada elemen keluar kontainer** dan **tidak ada teks terpotong** tak sengaja.
3. **Kontras WCAG AA** untuk setiap simpul teks.
4. **Tanpa gulir horizontal** halaman; tabel muat di desktop.
5. Tombol sejajar, geometri penggeser benar, tanpa galat konsol/JS.

Aturan praktis:
- Fokus: `outline: 2px solid var(--cyan); outline-offset: 2px` untuk semua `:focus-visible`; input memakai ring 3px `cyan/35`.
- Target sentuh ≥ 36px (tombol ikon), kontrol form 44px.
- Semua kontrol punya label; ikon dekoratif `aria-hidden`; kontrol ikon-saja punya `aria-label`.
- Peran ARIA: `role="alert"` untuk galat, `role="status"`/`aria-live="polite"` untuk toast, `role="progressbar"` dengan nilai, `aria-sort` di header tabel, `aria-current="page"` di pager, `aria-expanded` di bagian yang bisa dilipat.
- Jangan sampai browser mengubah warna field saat autofill (`-webkit-autofill` dipaksa ke `--surface`/`--ink`).
- Tema tidak boleh berkedip saat dimuat.

---

## 8. Aturan membuat UI baru

1. Pakai token, bukan hex. Pakai utilitas dari `@theme` (`bg-surface`, `text-ink2`, `border-line`, `bg-brand-soft`, `text-bad`, …).
2. Satukan lewat `cn()` (`clsx` + `tailwind-merge`) dan `cva` untuk varian.
3. Mulai dari komponen yang ada (`Button`, `Field`, `Input`, `Select`, `CheckRow`, `Card`, `Badge`, `Modal`, `Wizard`, `TableShell`, `Pager`, `EmptyState`, `HoldButton`, `SlideConfirm`); jangan membuat ulang.
4. Setiap halaman: `PageHeader` (eyebrow + judul dengan `<b>` + deskripsi + aksi), lalu kartu/tabel; ada `usePageTitle`.
5. Setiap daftar punya tiga keadaan: memuat (skeleton), kosong (`EmptyState`), terisi.
6. Satu kontrol = satu tinggi (44px). Satu aksi utama (primary) per tampilan.
7. Tambah form → perlakukan sebagai wizard satu kolom; definisi field berasal dari satu spesifikasi (`internal/itform/spec.go` → `lib/formspec.ts`), bukan ditulis ulang per halaman.
8. Selesai? Jalankan `make e2e` (audit UI harus hijau) dan cek terang + gelap di 390px.

### Jangan
- Bayangan pada kartu/tabel/tombol; gradien; warna di luar token.
- `confirm()` / `alert()` browser; dialog konfirmasi untuk hapus (pakai HoldButton).
- Teks abu-abu di bawah kontras AA; label hanya berupa placeholder.
- Dua pustaka animasi; animasi yang tidak mati saat reduced-motion.
- Tinggi kontrol berbeda dalam satu form; tombol Kembali/Lanjut terpisah jauh.
- Skrip inline (CSP melarang); CDN untuk font/CSS.

---

## 9. Pemetaan Bootstrap (versi PHP lama)

Skin di `dodit-design.css` dengan kelas induk `.dodit` pada `<body>`; memuat `bootstrap.min.css` → `app.css` → `dodit-design.css`.

| Konsep | Implementasi |
|---|---|
| Token | variabel di `.dodit` (`--bg --surface --surface2 --ink --ink2 --line --brand --cyan --ok --warn-* --bad-* --track`) dipetakan ke `--bs-*` |
| Tombol | `.btn` radius 999px, 13px/600, padding 9×18px; `.btn-sm` 12px |
| Input | `.form-control/.form-select` radius 10px, min-height 40px (42px di `.task-form`), fokus border `brand` + outline cyan |
| Kartu | `.card` radius 16px, border `line`, tanpa shadow; `.stat-card` radius 14px |
| Tabel | `.table` 13px, `thead th` 11px UPPERCASE `ink2` di `surface2`; mobile `table.mobile-ready` → kartu |
| Alert | `.alert` radius 12px; varian success/warning/danger memakai `*-bg` & `*-ink` |
| Modal | `.modal-content` radius 16px |
| Toast | `.app-toasts` kanan-atas (top 66px), `.app-toast` kartu netral + titik 7px |
| Slide-to-confirm | `.slide-confirm` (trek 54px, knob 42px, isi `#f1c9c6`) |
| Sidebar | latar `--brand` biru, teks putih, item aktif putih berteks navy (berbeda dari go-dod yang memakai sidebar terang) |
| Taskit-page | latar `#fafafa` |
| Gerak | `--ease: cubic-bezier(.2,.7,.2,1)`, `--dur: .18s`; `dodit-rise`, `dodit-pop`, `ti-rise` |

Catatan perbedaan: sidebar PHP berlatar biru solid, sidebar go-dod terang dengan pil aktif `brand-soft`. Versi go-dod yang dipakai untuk pekerjaan baru.
