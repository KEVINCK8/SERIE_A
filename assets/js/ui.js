import { modalManager } from "./modal-manager.js";

export const showView = (viewId) => {
    // Mapping settings to the visual Menu view
    const normalizedId = viewId === 'settings' ? 'settings' : viewId;

    // Hide all views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    
    // Show target view
    const targetView = document.getElementById(`${normalizedId}-view`);
    if (targetView) {
        targetView.classList.remove('hidden');
    }

    // Update nav active state
    document.querySelectorAll('.mobile-nav a').forEach(link => {
        if (link.dataset.view === viewId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // Scroll to top when changing view
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

export const toggleLoading = (show) => {
    const loader = document.getElementById('loading-overlay');
    if (!loader) return;
    
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
};

export const showNotification = (message, type = 'info') => {
    modalManager.showToast(message, type);
};

export const toggleAuthTabs = (tab) => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabs = document.querySelectorAll('.tab-btn');

    tabs.forEach(t => {
        if (t.dataset.tab === tab) {
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
    }
};

let countdownInterval = null;

export const updateMatchdayStatusCard = (giornata, predictionsCount, totalMatches, lockDate, notes = "") => {
    const container = document.getElementById('matchday-status-container');
    if (!container) return;

    // Update Giornata Number
    document.getElementById('home-giornata-num').textContent = giornata;

    // Update Progress
    const statusText = document.getElementById('prediction-status-text');
    const countText = document.getElementById('prediction-count');
    const progressFill = document.getElementById('prediction-progress-fill');
    
    const remaining = totalMatches - predictionsCount;
    const progressPercent = totalMatches > 0 ? (predictionsCount / totalMatches) * 100 : 0;

    if (totalMatches === 0) {
        statusText.textContent = "Nessuna partita programmata";
        countText.textContent = "0/0";
    } else if (remaining === 0) {
        statusText.textContent = "Tutti i pronostici inseriti! ✨";
        countText.textContent = `${predictionsCount}/${totalMatches}`;
    } else {
        statusText.textContent = `Ti mancano ${remaining} pronostici`;
        countText.textContent = `${predictionsCount}/${totalMatches}`;
    }

    progressFill.style.width = `${progressPercent}%`;

    // Update Notes
    const notesEl = document.getElementById('matchday-notes-home');
    if (notes) {
        notesEl.textContent = notes;
        notesEl.classList.remove('hidden');
    } else {
        notesEl.classList.add('hidden');
    }

    // Update Countdown
    const countdownEl = document.getElementById('lock-countdown');
    const timerVal = document.getElementById('timer-val');

    if (countdownInterval) clearInterval(countdownInterval);

    if (lockDate) {
        const target = new Date(lockDate).getTime();
        
        const updateTimer = () => {
            const now = new Date().getTime();
            const distance = target - now;

            if (distance < 0) {
                countdownEl.classList.add('hidden');
                clearInterval(countdownInterval);
                return;
            }

            countdownEl.classList.remove('hidden');
            
            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            let timerText = "";
            if (days > 0) timerText += `${days}g `;
            timerText += `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            timerVal.textContent = timerText;
        };

        updateTimer();
        countdownInterval = setInterval(updateTimer, 1000);
    } else {
        countdownEl.classList.add('hidden');
    }
};

export const renderGiornataSelect = (currentGiornata = 1, selectId = 'giornata-select') => {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    select.innerHTML = '';
    for (let i = 1; i <= 38; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Giornata ${i}`;
        if (i === currentGiornata) option.selected = true;
        select.appendChild(option);
    }
};

export const renderMatchdayScroll = (currentGiornata, containerId, onSelect) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Se non è già presente, aggiungiamo il wrapper e le frecce
    let wrapper = container.parentElement;
    if (!wrapper.classList.contains('matchday-scroll-wrapper')) {
        wrapper = document.createElement('div');
        wrapper.className = 'matchday-scroll-wrapper';
        container.parentNode.insertBefore(wrapper, container);
        
        const btnLeft = document.createElement('button');
        btnLeft.className = 'scroll-arrow left';
        btnLeft.innerHTML = '<i class="fas fa-chevron-left"></i>';
        
        const btnRight = document.createElement('button');
        btnRight.className = 'scroll-arrow right';
        btnRight.innerHTML = '<i class="fas fa-chevron-right"></i>';
        
        wrapper.appendChild(btnLeft);
        wrapper.appendChild(container);
        wrapper.appendChild(btnRight);
        
        // Logica di scorrimento
        btnLeft.onclick = () => {
            container.scrollBy({ left: -200, behavior: 'smooth' });
        };
        btnRight.onclick = () => {
            container.scrollBy({ left: 200, behavior: 'smooth' });
        };
    }

    container.innerHTML = '';
    for (let i = 1; i <= 38; i++) {
        const item = document.createElement('div');
        item.className = `matchday-item glass-card ${i === currentGiornata ? 'active' : ''}`;
        item.innerHTML = `
            <span class="md-label">GIORNATA</span>
            <span class="md-number">${i}</span>
        `;
        item.onclick = () => {
            container.querySelectorAll('.matchday-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            onSelect(i);
        };
        container.appendChild(item);

        if (i === currentGiornata) {
            setTimeout(() => {
                item.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
            }, 100);
        }
    }
};

const TEAM_LOGOS = {
    "JUVENTUS": "01-Juventus-FC-v2017.png",
    "INTER": "02-FC-Inter-Milan-v2021.png",
    "ATALANTA": "03-Atalanta-BC-v1993.png",
    "BOLOGNA": "04-Bologna-FC-v2018.png",
    "CAGLIARI": "05-Cagliari-Calcio-v2015.png",
    "COMO": "06-Como-1907-v2019.png",
    "FIORENTINA": "07-ACF-Fiorentina-v2022.png",
    "GENOA": "08-Genoa-CFC-v2022.png",
    "VERONA": "09-Hellas-Verona-v2020.png",
    "LAZIO": "10-SS-Lazio-v1993.png",
    "LECCE": "11-US-Lecce-v2001.png",
    "MILAN": "12-AC-Milan-v2009.png",
    "NAPOLI": "13-SSC-Napoli-v2024.png",
    "PARMA": "14-Parma-Calcio-1913-v2016.png",
    "ROMA": "15-AS-Roma-v2016.png",
    "TORINO": "16-Torino-FC-v2005.png",
    "UDINESE": "17-Udinese-Calcio-v2010.png",
    "SASSUOLO": "18-US-Sassuolo-Calcio-v2010.png",
    "PISA": "19-Pisa-SC-v2017.png",
    "CREMONESE": "20-US-Cremonese-v1997.png",
    "VENEZIA": "20-Venezia.png",
    "MONZA": "19-Monza-SC-v2017.png",
    "FROSINONE": "250px-Frosinonestemma.png"
};

export const getTeamLogo = (teamName) => {
    if (!teamName) return `https://coreva-normal.trae.ai/api/ide/v1/text_to_image?prompt=football+logo&image_size=square`;
    
    const name = teamName.toUpperCase().trim();
    const logoFile = TEAM_LOGOS[name];
    if (logoFile) {
        return `assets/image/loghi/${logoFile}`;
    }
    return `https://coreva-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(teamName + ' football logo')}&image_size=square`;
};
