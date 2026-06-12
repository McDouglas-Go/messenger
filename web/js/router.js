const Router = {
    routes: {},
    defaultRoute: 'login',

    add(hash, handler) {
        this.routes[hash] = handler;
    },

    setLayout(route) {
        const sidebar = document.getElementById('sidebar');               
        if (route === 'login' || route === 'register') {
            sidebar.style.display = 'none';
            document.body.classList.add('auth-page');
        } else {
            sidebar.style.display = '';       
            document.body.classList.remove('auth-page');
        }
    },

    load() {
        const hash = window.location.hash.substring(1) || this.defaultRoute;
        const handler = this.routes[hash];
        if (handler) {
            this.setLayout(hash);
            const main = document.getElementById('main');
            main.innerHTML = '';
            handler(main);
        } else {
            window.location.hash = '#' + this.defaultRoute;
        }
    }
};