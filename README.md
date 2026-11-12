# Hujjat aylanish tizimi

Namuna HTML (mock server) asosida yaratilgan **haqiqiy backend + veb-ilova**: REST API, JWT token, rollar (RBAC), SQLite, Docker, testlar.
Tashqi kutubxonalarsiz (zero-dependency): faqat Node.js 22.13+ ichki modullari.

## Tarkib

| Yo'l | Vazifasi |
|---|---|
| `src/` | Backend: `routes` → `service` (qoidalar, RBAC) → `repo` (SQL) → `db` |
| `public/` | Veb-ilova (`index.html`, `app.js`) va Swagger sahifasi (`docs.html`) |
| `scripts/` | `client-example.js` (token bilan ma'lumot olish), `healthcheck.js`, `user-admin.js` |
| `tests/` | `unit`, `integration`, `api`, `e2e`, `docker` |
| `Dockerfile`, `docker-compose.yml` | Konteynerlash |

## Tez boshlash (Docker)

```bash
cp .env.example .env
# .env ichida JWT_SECRET (>=32 belgi) va ADMIN_PASSWORD (>=8 belgi) ni to'ldiring:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
docker compose up -d --build        # build paytida testlar ham ishlaydi
docker compose ps                    # api: healthy bo'lishi kerak
```

- Veb-ilova: http://localhost:3000 (ID: `admin`, parol: `.env` dagi `ADMIN_PASSWORD`)
- Swagger: http://localhost:3000/docs · OpenAPI JSON: http://localhost:3000/api/v1/openapi.json
- Demo ma'lumotlar uchun `.env` da `SEED_DEMO=true` va `DEMO_PASSWORD=...` (faqat sinov uchun).

### Docker orqali API'dan token bilan ma'lumot olish

```bash
docker compose --profile tools run --rm client
```
`client` konteyneri `api` sog'lom bo'lgach ishga tushadi, login qiladi, tokenni oladi va hujjatlar/statistikani chop etadi (`scripts/client-example.js`).

## Lokal ishga tushirish (Docker'siz)

```bash
npm run build              # sintaksis, statik fayllar va API tekshiruvi
npm start                  # NODE_ENV=development bo'lsa kalit/parol avtomatik (ogohlantirish bilan)
npm run dev                # fayl o'zgarganda qayta ishga tushadi
```
Standart boshlang'ich akkauntlar (server ishga tushganda avtomatik yaratiladi va doim faol saqlanadi):
- Admin: `admin` / parol: `12345678` (roli: `admin`, production da `ADMIN_PASSWORD` bilan o'rnatiladi)
- Yangi xodimlar uchun shablon kirish: `U001` / parol: `12345678` (`EMPLOYEE_PASSWORD` bilan sozlanadi). `U001` bilan kirgan yangi xodimga majburiy ro'yxatdan o'tish oynasi chiqadi va shaxsiy akkaunt yaratiladi; `U001` shabloni esa keyingi xodimlar uchun o'zgarishsiz qoladi.

Ilova mobil brauzerlar hamda **Telegram Mini App (Web App)** ichida viewport va safe-area moslashuvi bilan ishlaydi.

## Render.com da Deploy qilish

> **Eslatma:** GitHub Pages faqat statik HTML/CSS/JS fayllarni ochadi (Node.js backend va SQLite bazasini ko'tara olmaydi, shu sababli `public/index.html` o'rniga `README.md` chiqib qolishi mumkin). Tizimni to'liq ishlatish uchun **Render.com** da Web Service sifatida joylashtiring.

Loyiha ildizidagi [`render.yaml`](render.yaml) orqali Render Blueprint sifatida yoki qo'lda quyidagi sozlamalar bilan ishga tushiring:
- **Build Command:** `npm run build`
- **Start Command:** `npm start` (`src/server.js` `process.env.PORT || 3000` portida ishlaydi va `public/` papkasidan statik fayllarni uzatadi)
- **Environment Variables:** `NODE_ENV=production`, `JWT_SECRET` (kamida 32 belgi), `ADMIN_PASSWORD=12345678`, `EMPLOYEE_PASSWORD=12345678`, `SEED_DEMO=false`, `TRUST_PROXY=true`

## API va token

Avtorizatsiya: **JWT (HS256)**. Sabab: server holatsiz (stateless), admin paneli kabi alohida frontend va server-server integratsiya uchun oddiy; qisqa muddatli access token + aylanuvchi (rotation) refresh token.
- `access_token` — 15 daqiqa (`ACCESS_TOKEN_TTL_SEC`), har so'rovda `Authorization: Bearer ...`
- `refresh_token` — 7 kun, bir martalik; ishlatilgan token qayta kelsa barcha tokenlar bekor qilinadi (o'g'irlikni aniqlash)
- Rol va faollik har so'rovda bazadan olinadi: foydalanuvchi o'chirilsa/roli o'zgarsa darhol kuchga kiradi.

```bash
API=http://localhost:3000/api/v1

# 1) Token olish
curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"admin","password":"PAROL"}'
# -> {"access_token":"...","refresh_token":"...","token_type":"Bearer","expires_in":900,"user":{...}}

# 2) Token bilan ma'lumot olish
TOKEN=...   # access_token
curl -s -H "Authorization: Bearer $TOKEN" "$API/documents?per_page=5&status=late"
curl -s -H "Authorization: Bearer $TOKEN" "$API/stats/summary?year=2026&month=11"

# 3) Tokenni yangilash
curl -s -X POST $API/auth/refresh -H 'Content-Type: application/json' -d '{"refresh_token":"..."}'

# 4) Tokensiz so'rov -> 401
curl -i $API/documents
```

### Endpointlar (to'liq hujjat: `/docs`)

| Metod | Yo'l | Ruxsat |
|---|---|---|
| GET | `/health` | ochiq |
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | ochiq |
| GET | `/auth/me`, `/data`, `/users`, `/organizations`, `/stats/summary` | barcha rollar |
| GET | `/documents` (`q,status,doc_status,org_id,date_from,date_to,page,per_page`), `/documents/:id`, `/tasks` | barcha rollar (oddiy xodim faqat o'zinikini) |
| POST | `/documents`, `/documents/:id/send`, `/tasks/:id/assignees` | admin, operator |
| PATCH | `/documents/:id` | admin, operator |
| DELETE | `/documents/:id` | admin |
| POST | `/documents/:id/sign` | faqat imzolovchining o'zi |
| PATCH | `/assignees/:id` | admin, operator, yoki bajaruvchining o'zi |
| GET | `/sms` | admin, operator |
| GET | `/audit` | admin |

Xato formati: `{"error":"...","code":"validation_error","details":[{"path":"deadline","message":"..."}],"request_id":"..."}`
Statuslar: 400 noto'g'ri JSON · 401 token · 403 ruxsat · 404 · 405 · 409 dublikat · 413 hajm · 415 · 422 validatsiya · 429 limit.

### Rollar

| Rol | Imkoniyat |
|---|---|
| `admin` | hammasi, shu jumladan hujjat o'chirish, audit, xodim ID kodlarini ko'rish |
| `operator` | hujjat yaratish/tahrirlash/yuborish, bajaruvchi biriktirish, SMS navbati |
| `viewer` | hamma ma'lumotni faqat o'qish |
| `user` | faqat o'ziga tegishli hujjat/topshiriqlar; imzolash; o'z topshirig'ini bajarilgan deb belgilash |

Parol/rolni o'zgartirish:
```bash
docker compose exec api node --disable-warning=ExperimentalWarning scripts/user-admin.js set-password U001 "YangiParol123"
docker compose exec api node --disable-warning=ExperimentalWarning scripts/user-admin.js set-role U002 operator
```

## Admin paneli (alohida domen) uchun CORS

`.env`: `CORS_ORIGINS=https://admin.example.uz` (vergul bilan bir nechta). Bo'sh bo'lsa faqat same-origin.
Reverse proxy (nginx/traefik) ortida: `TRUST_PROXY=1` (rate limit haqiqiy mijoz IP bo'yicha ishlaydi) va HTTPS/HSTS ni proksida yoqing.

## Testlar

```bash
npm test                 # barcha testlar
npm run test:coverage    # coverage, qator chegarasi 80%
SKIP_DOCKER_RUNTIME=1 npm test   # haqiqiy Docker testini o'tkazib yuborish
```
- `tests/unit` — sof funksiyalar (JWT, validator, holatlar, sanalar, rate limit)
- `tests/integration` — SQLite (migratsiya, cascade, tranzaksiya), repo, servis qoidalari, seed
- `tests/api` — HTTP: auth, RBAC matritsasi, CRUD, validatsiya, CORS, rate limit, xavfsizlik sarlavhalari
- `tests/e2e` — haqiqiy `server.js` jarayoni (healthcheck, SIGTERM, saqlanish) va `public/app.js` ↔ API kontrakti
- `tests/docker` — Docker fayllarini statik tekshirish; `docker compose up --wait` testi (Docker bor mashinada avtomatik ishlaydi)

`docker build` ham testlarni ishga tushiradi: test o'tmasa image yig'ilmaydi.

## Sozlamalar

Barchasi `.env.example` da izohlangan. Production'da `JWT_SECRET` va `ADMIN_PASSWORD` bo'lmasa server ishga tushmaydi.

## Ma'lum cheklovlar va keyingi qadamlar

- **SQLite** bitta instans uchun. Bir nechta instans/yuqori yuk bo'lsa PostgreSQL ga o'ting (`repo.js` yagona SQL qatlami) va rate limitni Redis'ga ko'chiring.
- Hujjatlar ro'yxatida holat bo'yicha filtr va sahifalash xotirada bajariladi (minglab hujjatgacha yaxshi).
- Imzolash tartibi (`ord`) majburiy emas; kerak bo'lsa `service.sign` ga qo'shiladi.
- SMS navbati (`sms_queue`) yoziladi; tashqi HTTP SMS provayderini (`Eskiz.uz`, `Playmobile`, maxsus HTTP API) Sozlamalar sahifasidan ulash va test qilish mumkin.
- E-imzo / doc.iiv.uz API integratsiyasi UI formasiga emas, hozircha REST API (`/api/v1/integrations/doc_system`, `telegram_bot`, `email_provider`) orqali saqlanadi.
- Swagger UI skriptlari `cdn.jsdelivr.net` dan yuklanadi (oflayn muhitda `/docs` ochilmaydi, `/api/v1/openapi.json` ishlaydi).

---

## v2.0.0 yangiliklari

**Yangi xodim shablon onboarding tizimi (`U001`)**
- `U001` shablon hisobi bilan kirganda yopib bo'lmaydigan majburiy ro'yxatdan o'tish oynasi ochiladi (`POST /auth/register-employee`)
- Yangi shaxsiy login, parol, tashkilot va lavozim saqlanib alohida xodim akkaunti yaratiladi; `U001` keyingi yangi xodimlar uchun o'zgarishsiz qoladi

**Topshiriq hayot sikli (Timeline)**
- `GET /documents/:id/timeline` — har bir hujjat bo'yicha to'liq voqealar tarixi: kimga biriktirildi, qachon ko'rildi, kimga uzatildi, qachon yakunlandi
- Hujjat sahifasida "📊 Hayot sikli" tugmasi

**Ko'rish vaqtini qayd etish**
- Hujjat ochilganda `viewed_at` vaqti avtomatik yoziladi
- Biriktirilgandan ko'rgunga qadar o'tgan vaqt ko'rsatiladi (daqiqa/soat)

**Xodim→Xodim uzatish (Delegatsiya)**
- `POST /assignees/:id/delegate` — topshiriqni boshqa faol oddiy xodimga uzatish, izoh bilan (`U001`, admin, operator, viewer va o'ziga uzatish bloklangan)
- `POST /assignees/:id/viewed` — ko'rilgan deb belgilash

**Foydalanuvchi boshqaruvi (admin panelda va CLI)**
- `POST /users`, `PATCH /users/:id`, `PATCH /users/:id/role`, `DELETE /users/:id` — yangi xodim qo'shish, tahrirlash, bloklash/faollashtirish, o'chirish
- Qo'shimcha CLI: `scripts/user-admin.js`

**Demo ma'lumotlarni tozalash**
- `POST /admin/clear-demo` — barcha hujjatlar va tegishli ma'lumotlar o'chiriladi (joriy adminning sessiya tokeni saqlanib qoladi)

**Integratsiyalar va SSRF himoyasi**
- `GET /integrations`, `POST /integrations/:key`, `DELETE /integrations/:key` — maxfiy token/parollar maskalanadi va lokal/ichki tarmoq manzillariga (SSRF) ruxsat berilmaydi
- Sozlamalar sahifasida SMS provayderi (Eskiz.uz, Playmobile, Maxsus HTTP API) formasi va test SMS tugmasi mavjud

**Bildirishnomalar**
- Yangi topshiriq kelganda va delegatsiyada avtomatik bildirishnoma
- `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`
- Sidebar'da o'qilmagan bildirishnomalar hisobi

**UI yaxshilishlari**
- Qorong'u ranglar sxemasi (dark theme), professional ko'rinish
- Hujjat kartalaridagi holat ranglari, muhimlik darajasi
- Kengaytirilgan hujjat sahifasi: ko'rish vaqti, delegatsiya, imzolar, almashinuvlar
- Foydalanuvchi boshqaruvi modali (admin uchun)

**Maydon qo'shimchasi**
- Hujjat va topshiriqda `priority` maydoni: urgent, high, normal, low
- Assignee da `viewed_at`, `delegated_to`, `delegated_at`, `delegation_note`
