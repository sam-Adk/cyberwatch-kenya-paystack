# 🛡️ CyberWatch Kenya
### A Full-Stack Cybersecurity Newsletter Platform

CyberWatch Kenya exposes online scams targeting Kenyans and sends alerts to subscribers via email.

---

## 📁 Project Structure

```
cyberwatch-kenya/
│
├── frontend/                  ← Static HTML/CSS/JS website
│   ├── index.html             ← Homepage with scam alerts, tips, subscribe form
│   ├── login.html             ← Admin login page
│   ├── dashboard.html         ← Admin dashboard
│   │
│   ├── css/
│   │   └── style.css          ← Cyberpunk dark theme
│   │
│   └── js/
│       ├── main.js            ← Homepage logic (fetch posts, subscribe, report)
│       └── dashboard.js       ← Admin dashboard logic
│
└── backend/                   ← Node.js + Express API server
    ├── server.js              ← Main entry point
    ├── package.json           ← Dependencies
    ├── .env.example           ← Copy this to .env and fill in values
    │
    ├── models/
    │   ├── User.js            ← Admin user schema
    │   ├── Newsletter.js      ← Scam post schema
    │   ├── Subscriber.js      ← Email subscriber schema
    │   └── ScamReport.js      ← User-submitted scam report schema
    │
    ├── controllers/
    │   ├── authController.js       ← Login / JWT
    │   └── newsletterController.js ← CRUD + email sending
    │
    ├── routes/
    │   ├── authRoutes.js           ← POST /api/auth/login
    │   ├── newsletterRoutes.js     ← GET/POST/PUT/DELETE /api/newsletters
    │   └── subscriberRoutes.js     ← Subscribe, report, admin lists
    │
    └── middleware/
        └── authMiddleware.js       ← JWT token verification
```

---

## 🏗️ Architecture Overview

```
Browser (HTML/CSS/JS)
        │
        │ HTTP requests (fetch API)
        ▼
Express.js Server (port 5000)
        │
        ├─── Auth Routes → bcrypt + JWT
        ├─── Newsletter Routes → CRUD operations
        └─── Subscriber Routes → subscribe/unsubscribe/report
              │
              ▼
         MongoDB Database
              │
              └─── Nodemailer (sends emails to subscribers)
```

**How Authentication Works:**
1. Admin logs in → server verifies password with bcrypt
2. Server creates a JWT (JSON Web Token) signed with a secret
3. Frontend stores JWT in localStorage
4. Every admin API request includes `Authorization: Bearer <token>`
5. Middleware verifies the token before allowing access

---

## 🚀 Setup Instructions (Step by Step)

### STEP 1: Install Node.js

Download from: https://nodejs.org (choose LTS version)

Verify installation:
```bash
node --version    # Should show v18+ or higher
npm --version     # Should show v9+
```

### STEP 2: Install MongoDB

**Option A: MongoDB Atlas (Free Cloud — Recommended for Beginners)**
1. Go to https://cloud.mongodb.com
2. Create a free account
3. Create a free cluster (M0)
4. Click "Connect" → "Connect your application"
5. Copy the connection string (looks like `mongodb+srv://user:pass@cluster.mongodb.net/`)

**Option B: Install MongoDB Locally**
- Download from: https://www.mongodb.com/try/download/community
- Install and start the service

### STEP 3: Configure Environment Variables

```bash
cd cyberwatch-kenya/backend

# Copy the example file
cp .env.example .env

# Open .env and fill in your values:
nano .env    # or open with any text editor
```

Edit `.env`:
```
PORT=5000
MONGO_URI=mongodb://localhost:27017/cyberwatch-kenya
# OR for Atlas:
# MONGO_URI=mongodb+srv://youruser:yourpass@cluster.mongodb.net/cyberwatch-kenya

JWT_SECRET=change_this_to_a_long_random_string_123456

# For Gmail: enable 2FA, then create an App Password at:
# https://myaccount.google.com/apppasswords
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-16-char-app-password
EMAIL_FROM=CyberWatch Kenya <your-gmail@gmail.com>

ADMIN_EMAIL=admin@cyberwatchkenya.com
ADMIN_PASSWORD=Admin@123456
```

### STEP 4: Install Dependencies

```bash
cd cyberwatch-kenya/backend
npm install
```

This installs:
- `express` — web server framework
- `mongoose` — MongoDB driver
- `bcryptjs` — password hashing
- `jsonwebtoken` — JWT authentication
- `nodemailer` — email sending
- `cors` — allows frontend to talk to backend
- `express-validator` — input validation
- `dotenv` — loads .env variables

### STEP 5: Start the Backend Server

```bash
# From the backend directory:
npm run dev     # Development (auto-restarts on file changes)
# OR
npm start       # Production
```

You should see:
```
✅ Connected to MongoDB
👤 Admin user created: admin@cyberwatchkenya.com
📰 Sample scam posts seeded
🚀 Server running on http://localhost:5000
```

### STEP 6: Open the Frontend

You can open the frontend in two ways:

**Option A: Direct File (Simplest)**
Just double-click `frontend/index.html` in your file explorer.

**Option B: Serve with a Simple HTTP Server**
```bash
# Install globally (one time):
npm install -g serve

# From the project root:
serve frontend -p 3000
```
Then visit: http://localhost:3000

### STEP 7: Access the Admin Dashboard

1. Go to http://localhost:3000/login.html (or open login.html directly)
2. Login with:
   - Email: `admin@cyberwatchkenya.com`
   - Password: `Admin@123456`
3. You'll be redirected to the dashboard

---

## 🔌 API Endpoints Reference

### Public Endpoints (No Authentication)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/newsletters` | Get published posts (with filters) |
| GET | `/api/newsletters/:id` | Get single post |
| POST | `/api/auth/login` | Admin login |
| POST | `/api/subscribers/subscribe` | Subscribe to newsletter |
| GET | `/api/subscribers/unsubscribe/:token` | Unsubscribe |
| POST | `/api/subscribers/report-scam` | Submit scam report |

### Protected Endpoints (Require JWT Token)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/me` | Get current user |
| GET | `/api/newsletters/admin/all` | All posts including drafts |
| POST | `/api/newsletters` | Create new post |
| PUT | `/api/newsletters/:id` | Update post |
| DELETE | `/api/newsletters/:id` | Delete post |
| POST | `/api/newsletters/:id/send` | Email to all subscribers |
| GET | `/api/subscribers/admin/list` | All subscribers |
| GET | `/api/subscribers/admin/reports` | All scam reports |

---

## 🔒 Security Features

1. **Password Hashing**: bcryptjs with 12 salt rounds
2. **JWT Authentication**: Tokens expire after 24 hours
3. **Input Validation**: express-validator on all POST routes
4. **CORS Protection**: Only allows specified origins
5. **HTML Escaping**: Prevents XSS in the frontend
6. **No Sensitive Data in JWT**: Passwords never in tokens
7. **Unsubscribe Tokens**: Cryptographically random tokens per subscriber

---

## 📧 Setting Up Gmail for Email Sending

1. Enable 2-Factor Authentication on your Google account
2. Go to: https://myaccount.google.com/apppasswords
3. Select "Mail" and your device
4. Google generates a 16-character password
5. Use this in your `.env` as `EMAIL_PASS`

---

## 🛠️ Troubleshooting

**"Cannot connect to server" on frontend**
→ Make sure backend is running: `npm run dev` in the `backend` folder

**"MongoDB connection failed"**
→ Check your MONGO_URI in `.env`
→ If using Atlas, make sure your IP is whitelisted

**"Failed to send newsletter"**
→ Check email credentials in `.env`
→ For Gmail, make sure you're using an App Password, not your regular password

**Posts not showing on homepage**
→ Make sure posts are set to `published: true` in the dashboard

---

## 🇰🇪 Built for Kenya

Report scams to:
- **DCI Kenya**: cybercrime@dci.go.ke
- **Communications Authority**: 0800 722 020
- **Safaricom Fraud**: 0722 000 100
