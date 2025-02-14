const express = require('express');
const bodyParser = require('body-parser');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const argon2 = require('argon2');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Configuration for EJS and static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'session_secret_example',
  resave: false,
  saveUninitialized: false
}));

// --- Encryption settings for the JSON storage ---
const encryptionAlgorithm = 'aes-256-cbc';
const encryptionPassword = 'my_super_secret_encryption_key_1234567890'; // use an env variable in production
// Derive a key (32 bytes) from the password
const encryptionKey = crypto.scryptSync(encryptionPassword, 'salt', 32);
// For demonstration, we use a static IV (16 bytes of zeros). In production use a random IV.
const iv = Buffer.alloc(16, 0);

// Path to our (encrypted) JSON file storing user data
const usersFilePath = path.join(__dirname, 'userData.json');

// Helper: read and decrypt user data from the file
function readUsers() {
  try {
    const encryptedData = fs.readFileSync(usersFilePath, 'utf8');
    if (!encryptedData) return {};
    const decipher = crypto.createDecipheriv(encryptionAlgorithm, encryptionKey, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    return {};
  }
}

// Helper: encrypt and save user data to the file
function saveUsers(users) {
  const data = JSON.stringify(users, null, 2);
  const cipher = crypto.createCipheriv(encryptionAlgorithm, encryptionKey, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  fs.writeFileSync(usersFilePath, encrypted, 'utf8');
}

// Global pepper for password hashing (should be kept secret)
const passwordPepper = 'global_pepper_example';

// Regex patterns for validations
const usernameRegex = /^[a-z0-9]+$/;
const nameRegex = /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/;
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

// Helper: check if user is at least 18 years old (expects yyyy-mm-dd format)
function isAdult(birthdate) {
  const today = new Date();
  const birth = new Date(birthdate);
  const age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    return age - 1;
  }
  return age;
}

// Routes

// Homepage with options for signup and login
app.get('/', (req, res) => {
  res.render('index', { user: req.session.user });
});

// GET /signup: generate 2FA secret and QR code, display registration form
app.get('/signup', async (req, res) => {
  // Generate a new TOTP secret
  const secret = speakeasy.generateSecret({ length: 20 });
  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret.base32,
    label: encodeURIComponent('Zypher'),
    issuer: 'Zypher',
    encoding: 'base32'
  });
  let qrCodeDataURL;
  try {
    qrCodeDataURL = await QRCode.toDataURL(otpauthUrl);
  } catch (err) {
    return res.status(500).send("Error generating QR Code");
  }
  res.render('signup', {
    qrCode: qrCodeDataURL,
    secret: secret.base32,
    message: null,
    formData: {}
  });
});

// POST /signup: process registration form
app.post('/signup', async (req, res) => {
  const { username, firstName, lastName, birthdate, password, token, secret } = req.body;

  // Basic validations
  let message = "";
  if (!usernameRegex.test(username)) {
    message = "Username must contain only lowercase letters and numbers.";
  } else if (!nameRegex.test(firstName) || !nameRegex.test(lastName)) {
    message = "Names can contain only letters (accents allowed) and spaces.";
  } else if (isAdult(birthdate) < 18) {
    message = "You must be at least 18 years old.";
  } else if (!passwordRegex.test(password)) {
    message = "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.";
  }
  if (message) {
    return res.render('signup', { qrCode: null, secret, message, formData: req.body });
  }

  // Verify 2FA token
  const tokenValid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1
  });
  if (!tokenValid) {
    message = "Invalid 2FA token. Please try again.";
    return res.render('signup', { qrCode: null, secret, message, formData: req.body });
  }

  // Hash password with pepper
  let passwordHash;
  try {
    passwordHash = await argon2.hash(password + passwordPepper);
  } catch (err) {
    return res.status(500).send("Error processing password");
  }

  // Read existing users and check if username exists
  const users = readUsers();
  if (users[username]) {
    message = "Username already exists. Please choose another.";
    return res.render('signup', { qrCode: null, secret, message, formData: req.body });
  }

  // Save new user data (store all sensitive info as-is because the JSON file is encrypted)
  users[username] = {
    firstName,
    lastName,
    birthdate,
    passwordHash,
    twoFASecret: secret
  };
  saveUsers(users);
  // After successful signup, redirect to login page
  res.redirect('/login');
});

// GET /login: display login form
app.get('/login', (req, res) => {
  res.render('login', { message: null, formData: {} });
});

// POST /login: process login
app.post('/login', async (req, res) => {
  const { username, password, token } = req.body;
  const users = readUsers();
  const user = users[username];
  if (!user) {
    return res.render('login', { message: "User not found. Please sign up first.", formData: req.body });
  }
  // Verify password
  let passwordValid = false;
  try {
    passwordValid = await argon2.verify(user.passwordHash, password + passwordPepper);
  } catch (err) {
    passwordValid = false;
  }
  if (!passwordValid) {
    return res.render('login', { message: "Incorrect password.", formData: req.body });
  }
  // Verify 2FA token
  const tokenValid = speakeasy.totp.verify({
    secret: user.twoFASecret,
    encoding: 'base32',
    token,
    window: 1
  });
  if (!tokenValid) {
    return res.render('login', { message: "Invalid 2FA token.", formData: req.body });
  }

  // Login successful; create session and redirect to dashboard
  req.session.user = username;
  res.redirect('/dashboard');
});

// GET /dashboard: protected main page after login
app.get('/dashboard', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const users = readUsers();
  const user = users[req.session.user];
  res.render('dashboard', { user: { username: req.session.user, ...user } });
});

// GET /logout: destroy session
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});