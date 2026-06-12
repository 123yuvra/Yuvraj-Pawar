require('dotenv').config({ override: true });
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// JSON DB Helpers
const projectsFile = path.join(__dirname, 'data', 'projects.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}
function getProjects() {
    try {
        const data = fs.readFileSync(projectsFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}
function saveProjects(projects) {
    fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 4));
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
// Ensure project images directory exists
const projectImagesDir = path.join(__dirname, 'public', 'images', 'projects');
if (!fs.existsSync(projectImagesDir)) {
    fs.mkdirSync(projectImagesDir, { recursive: true });
}

// Multer storage configuration for Resume
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Multer storage configuration for Projects
const projectStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/images/projects/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const uploadProject = multer({ storage: projectStorage });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'portfolio_admin_secret_key_123',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // false for localhost
}));

const requireAuth = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        res.redirect('/login');
    }
};

// EJS setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes for rendering pages
app.get('/', (req, res) => {
    const projects = getProjects();
    res.render('index', { projects });
});

app.get('/login', (req, res) => {
    if (req.session && req.session.isAdmin) {
        return res.redirect('/admin');
    }
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'yuvraj' && password === 'pawar') {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.render('login', { error: 'Invalid username or password' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/admin', requireAuth, (req, res) => {
    const projects = getProjects();
    res.render('admin', { projects });
});

// API endpoint for contact form submission
app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    
    console.log('New Contact Form Submission:');
    console.log(`Time: ${timestamp}\nName: ${name}\nEmail: ${email}\nMessage: ${message}`);
    
    let deliveryStatus = { email: 'Not configured', sms: 'Not configured', whatsapp: 'Not configured' };

    // 1. Send Email via Nodemailer
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
            });
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_USER, // Send to yourself
                subject: `New Portfolio Contact from ${name}`,
                text: `Time: ${timestamp}\nName: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
            });
            deliveryStatus.email = 'Sent';
            console.log('Email sent successfully!');
        } catch (error) {
            console.error('Email Error:', error.message);
            deliveryStatus.email = 'Failed';
        }
    }

    // 2. Send SMS & WhatsApp via Twilio
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.MY_PHONE_NUMBER) {
        try {
            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            const textMsg = `Portfolio Contact\nTime: ${timestamp}\nName: ${name}\nEmail: ${email}\nMsg: ${message}`;

            if (process.env.TWILIO_PHONE_NUMBER) {
                await client.messages.create({ body: textMsg, from: process.env.TWILIO_PHONE_NUMBER, to: process.env.MY_PHONE_NUMBER });
                deliveryStatus.sms = 'Sent';
            }
            if (process.env.TWILIO_WHATSAPP_NUMBER) {
                await client.messages.create({ body: textMsg, from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`, to: `whatsapp:${process.env.MY_PHONE_NUMBER}` });
                deliveryStatus.whatsapp = 'Sent';
            }
            console.log('Twilio messages sent successfully!');
        } catch (error) {
            console.error('Twilio Error:', error.message);
            deliveryStatus.sms = 'Failed';
            deliveryStatus.whatsapp = 'Failed';
        }
    }
    
    res.status(200).json({ success: true, message: 'Message sent!', delivery: deliveryStatus });
});

// Resume Upload Route
app.post('/api/resume/upload', requireAuth, upload.single('resume'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded. <a href="/admin">Go back</a>');
    }
    // Delete other files in the directory to keep only the latest
    fs.readdir(uploadsDir, (err, files) => {
        if (err) {
            console.error('Error reading uploads directory:', err);
        } else {
            for (const file of files) {
                if (file !== req.file.filename) {
                    fs.unlink(path.join(uploadsDir, file), err => {
                        if (err) console.error('Error deleting old resume:', err);
                    });
                }
            }
        }
        res.send('Resume uploaded successfully! <a href="/admin">Go back</a>');
    });
});

// Resume Download Route
app.get('/api/resume/download', (req, res) => {
    fs.readdir(uploadsDir, (err, files) => {
        if (err || files.length === 0) {
            return res.status(404).send('No resume found.');
        }
        const resumePath = path.join(uploadsDir, files[0]);
        res.download(resumePath);
    });
});

// ---- Project CRUD Routes ----

// Add Project Route
app.post('/api/projects/add', requireAuth, uploadProject.single('image'), (req, res) => {
    const { title, description, github, live } = req.body;
    const projects = getProjects();
    
    const newProject = {
        id: Date.now().toString(),
        title,
        description,
        github: github || '#',
        live: live || '#',
        image: req.file ? 'images/projects/' + req.file.filename : 'images/placeholder.png'
    };
    
    projects.push(newProject);
    saveProjects(projects);
    io.emit('projectAdded', newProject);
    res.redirect('/admin');
});

// Edit Project Route
app.post('/api/projects/edit/:id', requireAuth, uploadProject.single('image'), (req, res) => {
    const projects = getProjects();
    const index = projects.findIndex(p => p.id === req.params.id);
    
    if (index !== -1) {
        projects[index].title = req.body.title;
        projects[index].description = req.body.description;
        projects[index].github = req.body.github || '#';
        projects[index].live = req.body.live || '#';
        if (req.file) {
            const oldImage = projects[index].image;
            if (oldImage && oldImage !== 'images/placeholder.png') {
                const oldImagePath = path.join(__dirname, 'public', oldImage);
                fs.unlink(oldImagePath, err => {
                    if (err && err.code !== 'ENOENT') console.error('Error deleting old project image:', err);
                });
            }
            projects[index].image = 'images/projects/' + req.file.filename;
        }
        saveProjects(projects);
        io.emit('projectUpdated', projects[index]);
    }
    res.redirect('/admin');
});

// Delete Project Route
app.post('/api/projects/delete/:id', requireAuth, (req, res) => {
    let projects = getProjects();
    const projectToDelete = projects.find(p => p.id === req.params.id);
    if (projectToDelete) {
        const oldImage = projectToDelete.image;
        if (oldImage && oldImage !== 'images/placeholder.png') {
            const oldImagePath = path.join(__dirname, 'public', oldImage);
            fs.unlink(oldImagePath, err => {
                if (err && err.code !== 'ENOENT') console.error('Error deleting project image:', err);
            });
        }
    }
    projects = projects.filter(p => p.id !== req.params.id);
    saveProjects(projects);
    io.emit('projectDeleted', req.params.id);
    res.redirect('/admin');
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
