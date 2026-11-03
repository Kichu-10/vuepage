<template>
  <div class="page-frame" :class="`page-${currentPage}`">
    <PublicHeader
      :logo="b9Logo"
      :balance-label="signedIn ? `${currencyLabel} ${formatMoney(balance)}` : '--'"
      @open-menu="modal = 'menu'"
      @home="navigateTo('/')"
      @deposit="navigateTo('/wallet')"
      @toggle-search="toggleGameSearch"
    />
    <nav class="desktop-nav" aria-label="Main navigation">
      <button v-for="item in pageLinks" :key="item.path" :class="{ active: route.path === item.path }" @click="navigateTo(item.path)">
        {{ item.label }}
      </button>
      <button v-if="!signedIn" class="desktop-auth" @click="showAuth">Sign in</button>
      <button v-else class="desktop-auth" @click="toggleSignIn">Sign out</button>
    </nav>

    <div v-if="searchOpen && currentPage === 'games'" class="search-wrap">
      <Search class="search-input-icon" :size="18" />
      <input v-model="query" autofocus placeholder="Search games..." aria-label="Search games" />
      <button class="clear-search" aria-label="Close search" @click="searchOpen = false; query = ''"><X :size="18" /></button>
    </div>

    <main class="content">
      <template v-if="currentPage === 'home'">
      <section v-if="signedIn && activePromotions.length" class="promo-frame" aria-label="Member promotions">
        <div class="hero" :class="{ 'hero-with-art': homePromotion?.bannerUrl && !homePromotion.bannerIncludesText, 'hero-full-creative': homePromotion?.bannerUrl && homePromotion.bannerIncludesText }">
          <button v-if="homePromotion?.bannerUrl && homePromotion.bannerIncludesText" class="hero-creative-button" :aria-label="`View ${homePromotion.title}`" @click="navigateTo('/promotions')">
            <img class="hero-full-creative-image" :src="homePromotion.bannerUrl" alt="" />
          </button>
          <img
            v-else-if="homePromotion?.bannerUrl"
            class="hero-art"
            :src="homePromotion.bannerUrl"
            alt=""
          />
          <div v-if="!homePromotion?.bannerIncludesText || !homePromotion?.bannerUrl" class="hero-copy">
            <p class="hero-title"><span>{{ homePromotion?.title }}</span></p>
            <p class="hero-subtitle">{{ homePromotion?.description }}</p>
            <p class="hero-amount"><small>OFFER</small>{{ homePromotion?.reward || "See offer terms" }}</p>
            <button class="claim-button" @click="navigateTo('/promotions')">View offer <span><ChevronRight :size="20" :stroke-width="3" /></span></button>
          </div>
          <div v-if="activePromotions.length > 1 && (!homePromotion?.bannerIncludesText || !homePromotion?.bannerUrl)" class="hero-dots" aria-label="Promotion slides">
            <button
              v-for="(promotion, index) in activePromotions"
              :key="promotion.id"
              :class="{ selected: homePromotionIndex === index }"
              :aria-label="`Show promotion ${index + 1}: ${promotion.title}`"
              :aria-current="homePromotionIndex === index ? 'true' : undefined"
              @click="homePromotionIndex = index"
            />
          </div>
        </div>
      </section>
      <section v-else class="welcome-banner">
        <img :src="welcomeBanner" alt="B9 Game artwork featuring a woman" class="welcome-banner-image" />
        <div class="welcome-banner-copy"><span class="eyebrow">WELCOME TO B9 GAME</span><h1>Find your next game</h1><p>Browse games, manage your account, and view member offers after signing in.</p></div>
        <button v-if="!signedIn" class="primary-button" @click="showAuth">Sign in</button>
        <button v-else class="primary-button" @click="navigateTo('/games')">Browse games</button>
      </section>
      <section v-if="maintenanceMode" class="maintenance-banner" role="status">
        Scheduled maintenance is active. Transactions and support may experience delays.
      </section>

      <section class="announcement" aria-label="Latest announcement">
        <Volume2 class="announcement-volume" :size="20" :stroke-width="2.6" />
        <p>{{ platformAnnouncement }}</p>
        <button class="inbox-button" aria-label="Open inbox" @click="openInbox">
          <Mail :size="23" />
          <span v-if="unreadCount > 0" class="inbox-badge">{{ unreadCount > 99 ? "99+" : unreadCount }}</span>
        </button>
      </section>

      <nav class="categories" aria-label="Game categories">
        <button class="category-arrow" aria-label="Scroll categories left" @click="scrollCategories(-1)"><ChevronLeft :size="22" /></button>
        <div ref="categoryList" class="category-list">
          <button
            v-for="category in categoryItems"
            :key="category.label"
            class="category"
            :class="{ selected: category.label === selectedCategory }"
            @click="selectCategory(category.label)"
          >
            <span class="category-icon">
              <img :src="category.image" :alt="category.label" class="category-image" />
            </span>
            <span class="category-label">{{ category.label }}</span>
          </button>
        </div>
        <button class="category-arrow" aria-label="Scroll categories right" @click="scrollCategories(1)"><ChevronRight :size="22" /></button>
      </nav>

      <section class="jackpot" aria-label="Jackpot">
        <img :src="jackpotBanner" alt="JACKPOT" class="jackpot-banner" />
        <div class="jackpot-value">{{ jackpot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</div>
      </section>
      </template>

      <template v-if="currentPage === 'games'">
        <section v-if="maintenanceMode" class="maintenance-banner" role="status">
          Scheduled maintenance is active. Transactions and support may experience delays.
        </section>
        <nav class="categories" aria-label="Game categories">
          <button class="category-arrow" aria-label="Scroll categories left" @click="scrollCategories(-1)"><ChevronLeft :size="22" /></button>
          <div ref="categoryList" class="category-list">
            <button v-for="category in categoryItems" :key="category.label" class="category" :class="{ selected: category.label === selectedCategory }" @click="selectCategory(category.label)">
              <span class="category-icon"><img :src="category.image" :alt="category.label" class="category-image" /></span>
              <span class="category-label">{{ category.label }}</span>
            </button>
          </div>
          <button class="category-arrow" aria-label="Scroll categories right" @click="scrollCategories(1)"><ChevronRight :size="22" /></button>
        </nav>
        <section class="jackpot" aria-label="Jackpot">
          <img :src="jackpotBanner" alt="JACKPOT" class="jackpot-banner" />
          <div class="jackpot-value">{{ jackpot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</div>
        </section>
      </template>

      <section v-if="currentPage === 'home' || currentPage === 'games'" class="games-panel">
        <div class="section-heading">
          <h2><Flame class="section-flame" :size="27" :fill="'currentColor'" />{{ query ? "Results" : selectedCategory }}</h2>
          <button v-if="currentPage === 'home'" class="view-all" @click="navigateTo('/games')">
            View All <ChevronRight :size="17" />
          </button>
        </div>
        <p v-if="gamesLoading" class="empty-state">Loading games...</p>
        <p v-else-if="gamesError" class="empty-state">{{ gamesError }}</p>
        <p v-else-if="visibleGames.length === 0" class="empty-state">No games found</p>
        <div class="game-grid">
          <article
            v-for="game in visibleGames"
            :key="game.id"
            class="game-card"
            :class="[game.provider.toLowerCase().includes('pg') || game.gameType.toLowerCase().includes('slot') ? 'fortune-card' : 'fishing-card', { 'game-unavailable': game.status !== 0 }]"
            role="button"
            tabindex="0"
            :aria-label="game.status === 0 ? `Play ${game.name}` : `${game.name} unavailable`"
            :aria-disabled="game.status !== 0 || launchingGameId === game.id"
            @click="play(game)"
            @keydown.enter="play(game)"
            @keydown.space.prevent="play(game)"
          >
            <img :src="game.provider.toLowerCase().includes('pg') || game.gameType.toLowerCase().includes('slot') ? slot : fish" :alt="game.name" loading="lazy" />
            <div class="game-shade" />
            <span class="game-brand">{{ game.provider }}</span>
            <span class="game-art-title" aria-hidden="true">{{ game.name }}</span>
            <span class="game-name">{{ launchingGameId === game.id ? "Opening..." : game.name }}</span>
            <span v-if="game.status !== 0" class="game-status">{{ game.status === 1 ? "Maintenance" : "Unavailable" }}</span>
            <button
              class="favorite-button"
              :aria-label="favorites.includes(game.id) ? 'Remove favorite' : 'Add favorite'"
              @click.stop="toggleFavorite(game.id)"
            ><Star :size="17" :fill="favorites.includes(game.id) ? 'currentColor' : 'currentColor'" /></button>
          </article>
        </div>
      </section>

      <section v-else-if="currentPage === 'promotions'" class="page-section">
        <div class="page-heading">
          <span class="eyebrow">MEMBER REWARDS</span>
          <h1>Promotions</h1>
          <p>Offers and eligibility details provided by the platform.</p>
        </div>
        <div v-if="!signedIn" class="signed-out-card">
          <Gift :size="30" />
          <h2>Sign in to view promotions</h2>
          <p>Member offers are available to signed-in users and may have eligibility requirements.</p>
          <button class="primary-button" @click="showAuth">Sign in</button>
        </div>
        <p v-else-if="promotionsLoading" class="empty-state">Loading offers...</p>
        <p v-else-if="promotionsError" class="empty-state">{{ promotionsError }}</p>
        <p v-else-if="activePromotions.length === 0" class="empty-state">There are no active offers right now.</p>
        <div v-else class="promotion-grid">
          <article v-for="(promotion, index) in activePromotions" :key="promotion.id" class="promotion-banner" :class="{ 'promotion-full-creative': promotion.bannerIncludesText && promotion.bannerUrl }">
            <template v-if="promotion.bannerIncludesText && promotion.bannerUrl">
              <button class="promotion-complete-link" :aria-label="`Ask about ${promotion.title}`" @click="askAboutPromotion(promotion)">
                <img class="promotion-banner-complete" :src="promotion.bannerUrl" alt="" />
              </button>
              <div class="promotion-full-details">
                <h2>{{ promotion.title }}</h2>
                <p v-if="promotion.description">{{ promotion.description }}</p>
                <p v-if="promotion.terms" class="promotion-terms">{{ promotion.terms }}</p>
                <button class="primary-button" @click="askAboutPromotion(promotion)">Ask about this offer</button>
              </div>
            </template>
            <template v-else>
              <img v-if="promotion.bannerUrl" class="promotion-banner-art" :src="promotion.bannerUrl" alt="" />
              <div class="promotion-banner-copy">
                <span class="promotion-number">OFFER {{ String(index + 1).padStart(2, "0") }}</span>
                <span v-if="promotion.reward" class="promotion-value">{{ promotion.reward }}</span>
                <h2>{{ promotion.title }}</h2>
                <p v-if="promotion.description">{{ promotion.description }}</p>
                <p v-if="promotion.terms" class="promotion-terms">{{ promotion.terms }}</p>
                <button class="primary-button" @click="askAboutPromotion(promotion)">Ask about this offer</button>
              </div>
            </template>
          </article>
        </div>
        <aside class="responsible-play-note">
          <strong>Responsible play</strong>
          <p>Play responsibly: set limits and never gamble with money you cannot afford to lose. Offers are subject to the stated terms; contact support for eligibility and do not assume any bonus is credited automatically.</p>
        </aside>
      </section>

      <section v-else-if="currentPage === 'wallet'" class="page-section">
        <div class="page-heading">
          <span class="eyebrow">ACCOUNT FINANCES</span>
          <h1>Wallet</h1>
          <p>Manage your balance, payment requests, and game funds.</p>
        </div>
        <div v-if="!signedIn" class="signed-out-card">
          <Wallet :size="30" />
          <h2>Sign in to manage your wallet</h2>
          <p>Your balance and payment activity are available after signing in.</p>
          <button class="primary-button" @click="showAuth">Sign in</button>
        </div>
        <template v-else>
          <div class="wallet-summary-grid">
            <article class="wallet-summary main-wallet-summary">
              <span>Main wallet</span>
              <strong>{{ currencyLabel }} {{ formatMoney(balance) }}</strong>
              <small>Available account balance</small>
            </article>
            <article class="wallet-summary">
              <span>Game wallet · {{ gameWalletDisplayCurrency }}</span>
              <strong>{{ gameWalletLoading ? "Checking..." : `${gameWalletDisplayCurrency} ${formatMoney(gameWalletBalance)}` }}</strong>
              <small>Funds held by the game provider</small>
              <button class="text-action" :disabled="gameWalletLoading || returningGameFunds" @click="returnGameFunds">
                {{ returningGameFunds ? "Returning..." : "Return game funds" }}
              </button>
            </article>
          </div>
          <section class="wallet-workspace">
            <div class="wallet-workspace-heading">
              <div><span class="eyebrow">PAYMENTS</span><h2>Request a transaction</h2></div>
              <div class="wallet-tabs">
                <button :class="{ active: walletRequestType === 'deposit' }" @click="walletRequestType = 'deposit'">Deposit</button>
                <button :class="{ active: walletRequestType === 'withdrawal' }" @click="walletRequestType = 'withdrawal'">Withdraw</button>
              </div>
            </div>
            <p class="bonus-note">Submit a request for admin review and balance approval.</p>
            <div v-if="walletRequestType === 'deposit'" class="manual-payment-details">
              <strong>{{ paymentDetails.bankName }}</strong>
              <p v-if="paymentDetails.accountName"><span>Account name:</span> {{ paymentDetails.accountName }}</p>
              <p v-if="paymentDetails.accountNumber"><span>Account number:</span> {{ paymentDetails.accountNumber }}</p>
              <p v-if="paymentDetails.iban"><span>IBAN:</span> {{ paymentDetails.iban }}</p>
              <p v-if="paymentDetails.upiId"><span>UPI ID:</span> {{ paymentDetails.upiId }}</p>
              <p v-if="paymentDetails.walletNumber"><span>{{ paymentDetails.walletName || "Wallet" }}:</span> {{ paymentDetails.walletNumber }}</p>
              <small>{{ paymentDetails.instructions }}</small>
            </div>
            <div class="wallet-form">
              <div class="amount-options">
                <button v-for="preset in [500, 1000, 5000, 10000]" :key="preset" :class="{ chosen: amount === String(preset) }" @click="amount = String(preset)">{{ preset.toLocaleString() }}</button>
              </div>
              <input v-model="amount" class="amount-input" inputmode="numeric" :placeholder="`Amount (${currencyLabel})`" :aria-label="`Request amount in ${currencyLabel}`" @input="amount = amount.replace(/\D/g, '')" />
              <input v-model="paymentMethod" class="amount-input" :placeholder="walletRequestType === 'deposit' ? 'Payment method (bank, UPI, wallet)' : 'Withdrawal destination (bank, UPI, wallet)'" />
              <input v-if="walletRequestType === 'deposit'" v-model="paymentReference" class="amount-input" placeholder="Transaction or payment reference" required />
              <textarea v-model="paymentNote" class="manual-note" rows="3" :placeholder="walletRequestType === 'withdrawal' ? 'Account or wallet details and withdrawal instructions' : 'Optional payment note'" />
              <label v-if="walletRequestType === 'deposit'" class="payment-proof-label">Payment receipt or screenshot<input type="file" accept="image/jpeg,image/png,application/pdf" @change="setPaymentProof" required /></label>
              <button class="primary-button full-button" @click="submitWalletRequest">Submit {{ walletRequestType === "deposit" ? "Deposit" : "Withdrawal" }} Request</button>
            </div>
          </section>
          <section class="wallet-workspace transaction-list">
            <div class="wallet-workspace-heading">
              <div><span class="eyebrow">ACTIVITY</span><h2>Recent transactions</h2></div>
              <button class="text-action" @click="loadWalletTransactions">Refresh</button>
            </div>
            <p v-if="transactionLoading" class="empty-state">Loading transaction history...</p>
            <p v-else-if="walletTransactions.length === 0" class="empty-state">No wallet transactions yet.</p>
            <article v-for="transaction in walletTransactions" :key="transaction.id" class="transaction-card">
              <div><strong>{{ transaction.type === "deposit" ? "Deposit" : "Withdrawal" }}</strong><small>{{ formatDate(transaction.createdAt) }}</small><small v-if="transaction.paymentMethod">Method: {{ transaction.paymentMethod }}</small><small v-if="transaction.paymentReference">Reference: {{ transaction.paymentReference }}</small></div>
              <div class="transaction-result"><strong>{{ currencyLabel }} {{ formatMoney(transaction.amount) }}</strong><span :class="transaction.status">{{ transaction.status }}</span></div>
            </article>
          </section>
        </template>
      </section>

      <section v-else-if="currentPage === 'account'" class="page-section">
        <div class="page-heading">
          <span class="eyebrow">YOUR SPACE</span>
          <h1>Account</h1>
          <p>Profile, verification, saved games, and help.</p>
        </div>
        <template v-if="signedIn">
          <section class="account-card">
            <div class="account-avatar">
              <img v-if="displayedAvatarUrl" :src="displayedAvatarUrl" alt="Profile picture" @error="handleAvatarError" />
              <span v-else>{{ user?.username?.slice(0, 1).toUpperCase() || "U" }}</span>
            </div>
            <div class="account-identity"><span>Signed in as</span><strong>{{ user?.username }}</strong><small>{{ user?.email || "Email not set" }}</small></div>
            <button class="text-action" @click="modal = 'profile'">View profile</button>
          </section>
          <section class="account-balance">
            <Wallet :size="21" />
            <span>Available balance</span>
            <strong>{{ currencyLabel }} {{ formatMoney(balance) }}</strong>
          </section>
          <label class="avatar-upload-button" :class="{ uploading: avatarUploading }">
            <UserRound :size="18" />
            {{ avatarUploading ? "Uploading picture..." : displayedAvatarUrl ? "Change profile picture" : "Upload profile picture" }}
            <input type="file" accept="image/jpeg,image/png,image/webp" :disabled="avatarUploading" @change="uploadProfilePicture" />
          </label>
          <div class="account-action-grid">
            <button @click="openProfile"><UserRound :size="21" /><span><strong>Profile</strong><small>Personal and account details</small></span><ChevronRight :size="18" /></button>
            <button @click="openKyc"><ShieldCheck :size="21" /><span><strong>Identity verification</strong><small>{{ kycLabel }}</small></span><ChevronRight :size="18" /></button>
            <button @click="showFavorites"><Star :size="21" /><span><strong>Favorite games</strong><small>{{ favoriteNames }}</small></span><ChevronRight :size="18" /></button>
            <button @click="openInbox"><Mail :size="21" /><span><strong>Inbox</strong><small>{{ unreadCount }} unread messages</small></span><ChevronRight :size="18" /></button>
            <button @click="modal = 'support'"><LifeBuoy :size="21" /><span><strong>Help &amp; support</strong><small>Contact support about your account</small></span><ChevronRight :size="18" /></button>
          </div>
          <button class="sign-out-button" @click="toggleSignIn"><LogOut :size="19" />Sign out</button>
        </template>
        <div v-else class="signed-out-card">
          <UserRound :size="30" />
          <h2>Sign in to your account</h2>
          <p>Access your profile, verification status, saved games, and messages.</p>
          <button class="primary-button" @click="showAuth">Sign in or create account</button>
        </div>
      </section>
    </main>

    <BottomNav
      :active-page="route.path"
      @navigate="navigateTo"
    />

    <div v-if="modal" class="modal-backdrop" @click="modal = null">
      <section class="modal-sheet" role="dialog" aria-modal="true" :aria-label="modalTitle" @click.stop>
        <div class="modal-heading">
          <h2>{{ modalTitle }}</h2>
          <button class="close-button" aria-label="Close dialog" @click="modal = null"><X :size="22" /></button>
        </div>

        <form v-if="modal === 'auth'" class="modal-content auth-form" @submit.prevent="submitAuth">
          <div class="wallet-tabs">
            <button type="button" :class="{ active: authMode === 'login' }" @click="authMode = 'login'">Sign In</button>
            <button type="button" :class="{ active: authMode === 'register' }" @click="authMode = 'register'">Register</button>
          </div>
          <select v-model="authCountry" :aria-label="authMode === 'login' ? 'Country for Google Sign-In' : 'Country'" :required="authMode === 'register'">
            <option value="">{{ authMode === "login" ? "Select country for Google Sign-In" : "Select country" }}</option>
            <option value="IN">India</option>
            <option value="PK">Pakistan</option>
          </select>
          <div v-if="googleClientId" id="google-signin-button" class="google-signin-button" />
          <p v-else class="auth-configuration-note">Google Sign-In is not configured for this site.</p>
          <div class="auth-divider"><span>{{ authMode === "login" ? "or sign in with username" : "or create account with email" }}</span></div>
          <input v-model="authUsername" autocomplete="username" placeholder="Username" aria-label="Username" required minlength="3" />
          <template v-if="authMode === 'register'">
            <input v-model="authEmail" type="email" autocomplete="email" placeholder="Gmail or email address" aria-label="Email address" required />
          </template>
          <input v-model="authPassword" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required minlength="6" />
          <button class="primary-button full-button" type="submit" :disabled="authLoading">
            {{ authLoading ? "Please wait..." : authMode === "login" ? "Sign In" : "Create Account" }}
          </button>
        </form>

        <ul v-else-if="modal === 'menu'" class="menu-list">
          <li class="menu-section-label">My account</li>
          <li><button @click="navigateTo('/account')"><UserRound :size="20" />Profile &amp; account</button></li>
          <li><button @click="navigateTo('/wallet')"><Wallet :size="20" />Deposit &amp; withdraw</button></li>
          <li><button @click="openTransactionHistory"><Mail :size="20" />Transaction history</button></li>
          <li v-if="signedIn && user?.kycStatus !== 'verified'"><button @click="openKyc"><UserRound :size="20" />KYC verification</button></li>
          <li class="menu-section-label">Discover</li>
          <li><button @click="showFavorites"><Star :size="20" />My favorites</button></li>
          <li><button @click="navigateTo('/promotions')"><Gift :size="20" />Promotions</button></li>
          <li><button @click="openInbox"><Mail :size="20" />Inbox</button></li>
          <li class="menu-section-label">Game categories</li>
          <li v-for="category in categories" :key="category">
            <button @click="selectCategory(category); navigateTo('/games')"><Flame :size="20" />{{ category }}</button>
          </li>
          <li class="menu-section-label">Support</li>
          <li><button @click="modal = 'support'"><Mail :size="20" />Help &amp; support</button></li>
          <li v-if="signedIn"><button @click="toggleSignIn"><LogOut :size="20" />Sign out</button></li>
        </ul>

        <div v-else-if="modal === 'transactions'" class="modal-content transaction-list">
          <p v-if="transactionLoading" class="bonus-note">Loading transaction history...</p>
          <p v-else-if="walletTransactions.length === 0" class="empty-state">No wallet transactions yet.</p>
          <article v-for="transaction in walletTransactions" :key="transaction.id" class="transaction-card">
            <div>
              <strong>{{ transaction.type === "deposit" ? "Deposit" : "Withdrawal" }}</strong>
              <small>{{ formatDate(transaction.createdAt) }}</small>
              <small v-if="transaction.paymentMethod">Method: {{ transaction.paymentMethod }}</small>
              <small v-if="transaction.paymentReference">Reference: {{ transaction.paymentReference }}</small>
            </div>
            <div class="transaction-result">
              <strong>{{ currencyLabel }} {{ formatMoney(transaction.amount) }}</strong>
              <span :class="transaction.status">{{ transaction.status }}</span>
            </div>
          </article>
        </div>

        <div v-else-if="modal === 'favorites'" class="modal-content favorites-list">
          <p v-if="favoriteNames === 'None yet'" class="empty-state">You have no favorite games yet.</p>
          <button
            v-for="game in games.filter((item) => favorites.includes(item.id))"
            :key="game.id"
            class="favorite-game"
            @click="play(game); modal = null"
          >
            <img :src="game.provider.toLowerCase().includes('pg') || game.gameType.toLowerCase().includes('slot') ? slot : fish" :alt="game.name" />
            <span><strong>{{ game.name }}</strong><small>{{ game.provider }}</small></span>
          </button>
        </div>

        <div v-else-if="modal === 'support'" class="modal-content support-content">
          <p>For account, deposit, withdrawal, or KYC help:</p>
          <button class="support-row" @click="openInbox"><Mail :size="20" /><span><strong>Message center</strong><small>View account notices</small></span></button>
          <button v-if="signedIn && user?.kycStatus !== 'verified'" class="support-row" @click="openKyc"><UserRound :size="20" /><span><strong>KYC assistance</strong><small>Review document requirements</small></span></button>
          <button class="support-row" @click="modal = 'profile'"><UserRound :size="20" /><span><strong>Account details</strong><small>Review your profile</small></span></button>
          <div class="ticket-form">
            <input v-model="supportSubject" maxlength="100" placeholder="Subject" :disabled="!signedIn" />
            <textarea v-model="supportMessage" maxlength="1000" rows="3" placeholder="Describe your issue" :disabled="!signedIn"></textarea>
            <button class="primary-button" :disabled="supportLoading || !signedIn" @click="submitSupportTicket">{{ signedIn ? (supportLoading ? "Sending..." : "Send support request") : "Sign in to contact support" }}</button>
          </div>
        </div>

        <div v-else-if="modal === 'promo'" class="modal-content promo-list">
          <article v-for="promotion in activePromotions" :key="promotion.id" class="promo-card">
            <div>
              <strong>{{ promotion.title }}</strong>
              <p>{{ promotion.description }} {{ promotion.reward }}</p>
            </div>
            <button class="primary-button" @click="askAboutPromotion(promotion)">Ask support</button>
          </article>
        </div>

        <div v-else-if="modal === 'profile'" class="modal-content profile-info">
          <div class="profile-picture-editor">
            <div class="profile-avatar-preview">
              <img v-if="displayedAvatarUrl" :src="displayedAvatarUrl" alt="Your profile picture" @error="handleAvatarError" />
              <span v-else>{{ user?.username?.slice(0, 1).toUpperCase() || "U" }}</span>
            </div>
            <label class="avatar-upload-button" :class="{ uploading: avatarUploading }">
              <UserRound :size="18" />
              {{ avatarUploading ? "Uploading picture..." : displayedAvatarUrl ? "Change profile picture" : "Upload profile picture" }}
              <input type="file" accept="image/jpeg,image/png,image/webp" :disabled="avatarUploading" @change="uploadProfilePicture" />
            </label>
            <small class="upload-hint">JPEG, PNG, or WebP · up to 3 MB</small>
          </div>
          <p><strong>User:</strong> {{ user?.username || "Guest" }}</p>
          <p><strong>Balance:</strong> {{ currencyLabel }} {{ formatMoney(balance) }}</p>
          <p><strong>Phone:</strong> {{ user?.phone || "Not set" }}</p>
          <p><strong>Email:</strong> {{ user?.email || "Not set" }}</p>
          <p><strong>Country:</strong> {{ user?.country === "PK" ? "Pakistan" : user?.country === "IN" ? "India" : user?.country === "NP" ? "Nepal" : "Not set" }}</p>
          <p><strong>KYC:</strong> {{ kycLabel }}</p>
          <p><strong>Account:</strong> {{ user?.status || "Unknown" }}</p>
          <p><strong>Favorites:</strong> {{ favoriteNames }}</p>
          <button v-if="user?.kycStatus !== 'verified'" class="primary-button" @click="modal = 'kyc'">Complete KYC Verification</button>
        </div>

        <form v-else-if="modal === 'kyc'" class="modal-content kyc-form" @submit.prevent="submitKyc">
          <p class="kyc-note">Provide identity details matching your India or Pakistan documents.</p>
          <select v-model="kycCountry" required>
            <option value="">Select country</option>
            <option value="IN">India</option>
            <option value="PK">Pakistan</option>
          </select>
          <input v-model="kycFullName" placeholder="Full legal name" required />
          <input v-model="kycDob" type="date" aria-label="Date of birth" required />
          <select v-model="kycDocumentType" required>
            <option value="">Select document</option>
            <option v-if="kycCountry === 'IN'" value="aadhaar">Aadhaar</option>
            <option v-if="kycCountry === 'IN'" value="pan">PAN Card</option>
            <option v-if="kycCountry === 'IN'" value="passport">Indian Passport</option>
            <option v-if="kycCountry === 'PK'" value="cnic">CNIC</option>
            <option v-if="kycCountry === 'PK'" value="passport">Pakistan Passport</option>
          </select>
          <input v-model="kycDocumentNumber" placeholder="Document number" required />
          <input v-model="kycAddress" placeholder="Residential address" required />
          <label>Front of document<input type="file" accept="image/jpeg,image/png,application/pdf" @change="setKycFile('front', $event)" required /></label>
          <label v-if="kycCountry === 'PK' && kycDocumentType === 'cnic'">Back of document<input type="file" accept="image/jpeg,image/png,application/pdf" @change="setKycFile('back', $event)" required /></label>
          <label>Selfie holding document<input type="file" accept="image/jpeg,image/png" @change="setKycFile('selfie', $event)" required /></label>
          <button class="primary-button full-button" type="submit" :disabled="kycLoading">{{ kycLoading ? "Submitting..." : "Submit KYC" }}</button>
        </form>

        <div v-else-if="modal === 'inbox'" class="message-list">
          <p v-if="inboxLoading" class="empty-state">Loading inbox...</p>
          <p v-else-if="inboxMessages.length === 0" class="empty-state">No account messages yet.</p>
          <article
            v-for="message in inboxMessages"
            :key="message.id"
            class="inbox-message"
            :class="{ unread: !message.read, [`inbox-${message.type}`]: true }"
          >
            <div class="inbox-message-heading">
              <strong>{{ message.title }}</strong>
              <small>{{ formatDate(message.createdAt) }}</small>
            </div>
            <p>{{ message.message }}</p>
          </article>
        </div>
      </section>
    </div>

    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSessionStore } from "./stores/session";
import PublicHeader from "./components/PublicHeader.vue";
import BottomNav from "./components/BottomNav.vue";
import {
  ChevronLeft, ChevronRight, Flame, Gift, LifeBuoy,
  LogOut, Mail, Search, ShieldCheck, Star, UserRound,
  Volume2, Wallet, X,
} from "lucide-vue-next";
import fish from "./assets/g-fish.jpg";
import slot from "./assets/g-slot.jpg";
import b9Logo from "./assets/b9-logo.jpg";
import welcomeBanner from "./assets/banner.jpg";
import jackpotBanner from "./assets/jackpot-banner.jpg";
import popularCategory from "./assets/01_popular.png";
import pgSlotCategory from "./assets/02_pg_slot.png";
import spribeCategory from "./assets/03_spribe.png";
import fishingCategory from "./assets/04_fishing.png";
import inOutCategory from "./assets/05_inout.png";

type GameCategory = "Popular" | "PG Slot" | "Spribe" | "Fishing" | "InOut";
type Modal = "menu" | "promo" | "profile" | "inbox" | "auth" | "kyc" | "transactions" | "favorites" | "support" | null;
type AuthUser = { id: string; username: string; phone: string; email: string; country: string; kycStatus: string; role: "user" | "admin"; balance: number; status: string; createdAt: string; lastLoginAt: string | null; googlePictureUrl?: string };
type WalletTransaction = { id: string; type: "deposit" | "withdrawal"; amount: number; status: string; createdAt: string; paymentMethod?: string; paymentReference?: string; paymentNote?: string };
type PaymentDetails = { bankName: string; accountName: string; accountNumber: string; iban: string; upiId: string; walletName: string; walletNumber: string; instructions: string };
type InboxMessage = { id: string; type: string; title: string; message: string; read: boolean; createdAt: string };
type Promotion = { id: string; title: string; description: string; reward: string; terms: string; active: boolean; bannerImage?: string; bannerUrl?: string; bannerIncludesText?: boolean };
type Game = {
  id: string;
  name: string;
  provider: string;
  providerCode: string;
  gameType: string;
  status: number;
};

const categories: GameCategory[] = ["Popular", "PG Slot", "Spribe", "Fishing", "InOut"];
const pageLinks = [
  { path: "/", label: "Home" },
  { path: "/games", label: "Games" },
  { path: "/promotions", label: "Promotions" },
  { path: "/wallet", label: "Wallet" },
  { path: "/account", label: "Account" },
];
const categoryItems = [
  { label: "Popular" as const, image: popularCategory },
  { label: "PG Slot" as const, image: pgSlotCategory },
  { label: "Spribe" as const, image: spribeCategory },
  { label: "Fishing" as const, image: fishingCategory },
  { label: "InOut" as const, image: inOutCategory },
];
const selectedCategory = ref<GameCategory>("Popular");
const games = ref<Game[]>([]);
const gamesLoading = ref(true);
const gamesError = ref("");
const launchingGameId = ref<string | null>(null);
const balance = ref(8891.2);
const jackpot = ref(10799004.2);
const favorites = ref<string[]>([]);
const query = ref("");
const searchOpen = ref(false);
const modal = ref<Modal>(null);
const signedIn = ref(false);
const amount = ref("1000");
const categoryList = ref<HTMLElement | null>(null);
const notice = ref("");
const session = useSessionStore();
const token = toRef(session, "userToken");
const route = useRoute();
const router = useRouter();
const user = ref<AuthUser | null>(null);
const currencyCode = computed(() => {
  if (user.value?.country === "IN") return "INR";
  if (user.value?.country === "PK") return "PKR";
  if (user.value?.country === "NP") return "NPR";
  return "";
});
const currencyLabel = computed(() => displayCurrency(currencyCode.value));
const gameWalletDisplayCurrency = computed(() => displayCurrency(gameWalletCurrency.value || currencyCode.value));
const avatarUrl = ref("");
const displayedAvatarUrl = computed(() => avatarUrl.value || user.value?.googlePictureUrl || "");
const avatarLoading = ref(false);
const avatarUploading = ref(false);
const authMode = ref<"login" | "register">("login");
const authUsername = ref("");
const authEmail = ref("");
const authPassword = ref("");
const authCountry = ref("");
const authLoading = ref(false);
const kycCountry = ref("");
const kycFullName = ref("");
const kycDob = ref("");
const kycDocumentType = ref("");
const kycDocumentNumber = ref("");
const kycAddress = ref("");
const kycLoading = ref(false);
const kycFiles = ref<Record<string, File | undefined>>({});
const walletRequestType = ref<"deposit" | "withdrawal">("deposit");
const walletTransactions = ref<WalletTransaction[]>([]);
const transactionLoading = ref(false);
const paymentMethod = ref("");
const paymentReference = ref("");
const paymentNote = ref("");
const paymentProof = ref<File | undefined>();
const paymentDetails = ref<PaymentDetails>({
  bankName: "", accountName: "", accountNumber: "", iban: "", upiId: "", walletName: "", walletNumber: "", instructions: "",
});
const gameWalletBalance = ref(0);
const gameWalletCurrency = ref("");
const gameWalletLoading = ref(false);
const returningGameFunds = ref(false);
const inboxMessages = ref<InboxMessage[]>([]);
const unreadCount = ref(0);
const inboxLoading = ref(false);
const platformAnnouncement = ref("Welcome to B9 Game. Play responsibly and review applicable terms.");
const supportSubject = ref("");
const supportMessage = ref("");
const supportLoading = ref(false);
const maintenanceMode = ref(false);
const promotions = ref<Promotion[]>([]);
const promotionsLoading = ref(false);
const promotionsError = ref("");
const homePromotionIndex = ref(0);
const googleClientId = ref("");
let inboxTimer: ReturnType<typeof setInterval> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let promotionCarouselTimer: ReturnType<typeof setInterval> | undefined;
let googleScriptPromise: Promise<void> | undefined;
let googleInitialized = false;

const currentPage = computed(() => route.path.slice(1) || "home");
const activePromotions = computed(() => promotions.value.filter((promotion) => promotion.active));
const homePromotion = computed(() => activePromotions.value[homePromotionIndex.value] || activePromotions.value[0]);
const kycLabel = computed(() => {
  if (user.value?.kycStatus === "verified") return "Verified";
  if (user.value?.kycStatus === "pending") return "Pending review";
  if (user.value?.kycStatus === "rejected") return "Rejected — resubmit";
  return "Not submitted";
});
const visibleGames = computed(() => {
  const search = query.value.trim().toLowerCase();
  const filtered = search
    ? games.value.filter((game) => game.name.toLowerCase().includes(search))
    : games.value.filter((game) => {
      const provider = game.provider.toLowerCase();
      if (selectedCategory.value === "Popular") return true;
      const gameType = game.gameType.toLowerCase();
      if (selectedCategory.value === "PG Slot") return ["pg", "jili", "pragmatic"].some((name) => provider.includes(name)) || gameType.includes("slot");
      if (selectedCategory.value === "Spribe") return provider.includes("spribe");
      if (selectedCategory.value === "Fishing") return provider.includes("fish") || gameType.includes("fish");
      return provider.includes("inout") || gameType.includes("inout");
    });
  return currentPage.value === "home" ? filtered.slice(0, 6) : filtered;
});
const modalTitle = computed(() => {
  if (modal.value === "promo") return "Promotions";
  if (modal.value === "auth") return authMode.value === "login" ? "Sign In" : "Create Account";
  if (modal.value === "kyc") return "KYC Verification";
  if (modal.value === "transactions") return "Transaction History";
  if (modal.value === "favorites") return "My Favorites";
  if (modal.value === "support") return "Help & Support";
  if (modal.value === "profile") return "Profile & Account";
  if (modal.value === "menu") return "Menu";
  if (modal.value === "inbox") return "Inbox";
  return modal.value ?? "";
});
const favoriteNames = computed(() => {
  const names = games.value.filter((game) => favorites.value.includes(game.id)).map((game) => game.name);
  return names.length ? names.join(", ") : "None yet";
});

watch([modal, authMode, googleClientId], () => {
  if (modal.value === "auth" && googleClientId.value) {
    window.setTimeout(() => {
      void googleLogin().catch((error: unknown) => notify(error instanceof Error ? error.message : "Could not load Google Sign-In"));
    }, 0);
  }
});

watch(() => [route.path, signedIn.value] as const, ([path, isSignedIn]) => {
  if (isSignedIn) void loadPromotions();
  else promotions.value = [];
  if (path === "/wallet" && isSignedIn) {
    void refreshGameWallet();
    void loadWalletTransactions();
  }
});

watch([signedIn, () => route.path, modal], ([isSignedIn, path, activeModal]) => {
  if (!isSignedIn) {
    clearAvatarUrl();
    return;
  }
  if (path === "/account" || activeModal === "profile") {
    void loadProfilePicture().catch((error: unknown) => notify(error instanceof Error ? error.message : "Could not load profile picture"));
  }
});

onMounted(async () => {
  promotionCarouselTimer = setInterval(() => {
    if (currentPage.value === "home" && activePromotions.value.length > 1) {
      homePromotionIndex.value = (homePromotionIndex.value + 1) % activePromotions.value.length;
    }
  }, 5000);
  void loadGames();
  token.value = localStorage.getItem("b9_token") || "";
  try {
    paymentDetails.value = await fetch("/api/payment/details").then((response) => response.json());
  } catch {
    paymentDetails.value.instructions = "Transfer the exact amount, then submit the payment reference and proof.";
  }
  try {
    const settings = await fetch("/api/platform/settings").then((response) => response.json());
    if (settings.announcement) platformAnnouncement.value = settings.announcement;
    maintenanceMode.value = Boolean(settings.maintenanceMode);
    googleClientId.value = settings.googleClientId || "";
  } catch {
    // Keep the built-in announcement when platform settings are unavailable.
  }
  if (token.value) {
    await restoreSession();
    if (signedIn.value) startInboxPolling();
  }
});
onUnmounted(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
  if (inboxTimer) clearInterval(inboxTimer);
  if (promotionCarouselTimer) clearInterval(promotionCarouselTimer);
  clearAvatarUrl();
});

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token.value) headers.set("Authorization", "Bearer " + token.value);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function restoreSession(): Promise<void> {
  try {
    const data = await api("/api/auth/me");
    user.value = data.user;
    signedIn.value = true;
    balance.value = data.user.balance;
  } catch {
    localStorage.removeItem("b9_token");
    token.value = "";
    signedIn.value = false;
    user.value = null;
  }
}

function clearAvatarUrl(): void {
  if (avatarUrl.value) URL.revokeObjectURL(avatarUrl.value);
  avatarUrl.value = "";
}

function handleAvatarError(): void {
  if (avatarUrl.value) clearAvatarUrl();
  else if (user.value) user.value.googlePictureUrl = "";
}

async function loadProfilePicture(): Promise<void> {
  const sessionToken = token.value;
  if (!sessionToken || avatarLoading.value) return;
  avatarLoading.value = true;
  try {
    const response = await fetch("/api/auth/profile/avatar", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (token.value !== sessionToken) return;
    if (response.status === 404) {
      clearAvatarUrl();
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Could not load profile picture");
    }
    const nextUrl = URL.createObjectURL(await response.blob());
    if (token.value !== sessionToken) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    clearAvatarUrl();
    avatarUrl.value = nextUrl;
  } finally {
    avatarLoading.value = false;
  }
}

async function uploadProfilePicture(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    notify("Choose a JPEG, PNG, or WebP image");
    input.value = "";
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    notify("Profile pictures must be 3 MB or smaller");
    input.value = "";
    return;
  }
  const form = new FormData();
  form.append("avatar", file);
  avatarUploading.value = true;
  try {
    await api("/api/auth/profile/avatar", { method: "POST", body: form });
    await loadProfilePicture();
    notify("Profile picture updated");
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not update profile picture");
  } finally {
    avatarUploading.value = false;
    input.value = "";
  }
}

async function refreshInbox(): Promise<void> {
  if (!signedIn.value || !token.value) return;
  try {
    const data = await api("/api/inbox");
    inboxMessages.value = data.notifications || [];
    unreadCount.value = Number(data.unreadCount || 0);
  } catch {
    unreadCount.value = 0;
  }
}

function startInboxPolling(): void {
  if (inboxTimer) clearInterval(inboxTimer);
  void refreshInbox();
  inboxTimer = setInterval(() => { void refreshInbox(); }, 5000);
}

async function openInbox(): Promise<void> {
  if (requireSignIn()) return;
  modal.value = "inbox";
  inboxLoading.value = true;
  await refreshInbox();
  try {
    await api("/api/inbox/read", { method: "PATCH", body: "{}" });
    unreadCount.value = 0;
    inboxMessages.value = inboxMessages.value.map((message) => ({ ...message, read: true }));
  } catch {
    // The inbox remains available even if the read-state update fails.
  } finally {
    inboxLoading.value = false;
  }
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}
function displayCurrency(currency: string): string {
  return currency === "INR" || currency === "NPR" ? "Rs." : currency;
}
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}
function notify(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ""; }, 3000);
}
async function submitSupportTicket(): Promise<void> {
  if (!signedIn.value) {
    modal.value = "auth";
    return;
  }
  if (!supportSubject.value.trim() || !supportMessage.value.trim()) {
    notify("Enter both a subject and support message");
    return;
  }
  supportLoading.value = true;
  try {
    await api("/api/support/tickets", {
      method: "POST",
      body: JSON.stringify({ subject: supportSubject.value.trim(), message: supportMessage.value.trim() }),
    });
    supportSubject.value = "";
    supportMessage.value = "";
    notify("Support request sent successfully");
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not send support request");
  } finally {
    supportLoading.value = false;
  }
}
function requireSignIn(): boolean {
  if (signedIn.value) return false;
  notify("Please sign in first");
  modal.value = "auth";
  return true;
}
async function loadGames(): Promise<void> {
  gamesLoading.value = true;
  gamesError.value = "";
  try {
    const data = await api("/api/games");
    games.value = data.games;
  } catch (error) {
    games.value = [];
    const message = error instanceof Error ? error.message : "";
    gamesError.value = message === "Game provider is not configured"
      ? "Game catalog will appear after the provider is configured on the server."
      : /too many requests|rate limit|cooling down/i.test(message)
        ? "HUIDU has temporarily rate-limited game catalog requests. Please wait for the provider quota to reset; repeated refreshes will not restore access."
      : /invalid hash code/i.test(message)
        ? "HUIDU rejected the game-catalog request (error 1004: Invalid hash code). The provider must confirm the catalog API authentication or issue valid API access."
      : /HUIDU/i.test(message)
        ? "Games are temporarily unavailable. Please check the HUIDU API configuration and try again."
        : "Games are temporarily unavailable. Please try again later.";
  } finally {
    gamesLoading.value = false;
  }
}
async function loadPromotions(): Promise<void> {
  if (!signedIn.value) return;
  promotionsLoading.value = true;
  promotionsError.value = "";
  try {
    const data = await api("/api/promotions");
    promotions.value = data.promotions;
  } catch (error) {
    promotions.value = [];
    promotionsError.value = error instanceof Error ? error.message : "Could not load promotions";
  } finally {
    promotionsLoading.value = false;
  }
}
function navigateTo(path: string): void {
  modal.value = null;
  if (path !== "/games") searchOpen.value = false;
  void router.push(path);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function toggleGameSearch(): void {
  if (route.path !== "/games") {
    navigateTo("/games");
    searchOpen.value = true;
    return;
  }
  searchOpen.value = !searchOpen.value;
  if (!searchOpen.value) query.value = "";
}
async function refreshGameWallet(): Promise<void> {
  if (!signedIn.value) return;
  gameWalletLoading.value = true;
  try {
    const data = await api("/api/games/wallet");
    gameWalletBalance.value = Number(data.balance || 0);
    gameWalletCurrency.value = data.currency || currencyCode.value;
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not check the game wallet");
  } finally {
    gameWalletLoading.value = false;
  }
}
async function returnGameFunds(): Promise<void> {
  if (returningGameFunds.value) return;
  returningGameFunds.value = true;
  try {
    const data = await api("/api/games/wallet/return", { method: "POST", body: "{}" });
    gameWalletBalance.value = 0;
    balance.value = data.balance;
    if (user.value) user.value.balance = data.balance;
    notify(`${displayCurrency(data.currency)} ${formatMoney(data.amount)} returned to your main wallet`);
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not return game funds");
    await refreshGameWallet();
  } finally {
    returningGameFunds.value = false;
  }
}
function selectCategory(category: GameCategory): void {
  selectedCategory.value = category;
  query.value = "";
}
function scrollCategories(direction: number): void {
  categoryList.value?.scrollBy({ left: direction * 120, behavior: "smooth" });
}
function toggleFavorite(id: string): void {
  favorites.value = favorites.value.includes(id)
    ? favorites.value.filter((favorite) => favorite !== id)
    : [...favorites.value, id];
}
async function play(game: Game): Promise<void> {
  if (requireSignIn()) return;
  if (game.status !== 0) {
    notify("This game is currently unavailable");
    return;
  }
  if (launchingGameId.value !== null) return;
  const gameWindow = window.open("about:blank", "_blank");
  if (!gameWindow) {
    notify("Allow pop-ups to launch a game");
    return;
  }
  gameWindow.opener = null;
  launchingGameId.value = game.id;
  try {
    const platform = window.matchMedia("(max-width: 760px)").matches ? 2 : 1;
    const data = await api(`/api/games/${encodeURIComponent(game.id)}/launch`, {
      method: "POST",
      body: JSON.stringify({ platform }),
    });
    balance.value = Number(data.balance);
    if (user.value) user.value.balance = balance.value;
    gameWindow.location.replace(data.gameUrl);
  } catch (error) {
    gameWindow.close();
    notify(error instanceof Error ? error.message : "Unable to play");
  } finally {
    launchingGameId.value = null;
  }
}
async function submitWalletRequest(): Promise<void> {
  const value = Number(amount.value);
  if (!value || value < 100) {
    notify(`Minimum ${walletRequestType.value === "deposit" ? "deposit" : "withdrawal"} is ${currencyLabel.value} 100`);
    return;
  }
  if (!paymentMethod.value.trim()) {
    notify(walletRequestType.value === "withdrawal" ? "Enter your withdrawal destination" : "Enter the payment method");
    return;
  }
  if (walletRequestType.value === "withdrawal" && paymentNote.value.trim().length < 6) {
    notify("Enter valid bank, UPI, or wallet account details");
    return;
  }
  if (walletRequestType.value === "deposit" && !paymentReference.value.trim()) {
    notify("Enter the payment or transaction reference");
    return;
  }
  if (walletRequestType.value === "deposit" && !paymentProof.value) {
    notify("Upload the payment receipt or screenshot");
    return;
  }
  const form = new FormData();
  form.append("type", walletRequestType.value);
  form.append("amount", String(value));
  form.append("paymentMethod", paymentMethod.value.trim());
  form.append("paymentReference", paymentReference.value.trim());
  form.append("paymentNote", paymentNote.value.trim());
  if (paymentProof.value) form.append("proof", paymentProof.value);
  try {
    await api("/api/wallet/request", {
      method: "POST",
      body: form,
    });
    modal.value = null;
    paymentMethod.value = "";
    paymentReference.value = "";
    paymentNote.value = "";
    paymentProof.value = undefined;
    notify(`${walletRequestType.value === "deposit" ? "Deposit" : "Withdrawal"} request submitted for admin approval`);
  } catch (error) {
    notify(error instanceof Error ? error.message : "Request failed");
  }
}
function askAboutPromotion(promotion: Promotion): void {
  if (requireSignIn()) return;
  supportSubject.value = `Promotion question: ${promotion.title}`.slice(0, 100);
  supportMessage.value = `Please confirm the eligibility and terms for the "${promotion.title}" offer.`;
  modal.value = "support";
}
async function googleLogin(): Promise<void> {
  const clientId = googleClientId.value;
  if (!clientId) {
    notify("Google Sign-In is not configured");
    return;
  }
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript && (window as { google?: unknown }).google) {
        resolve();
        return;
      }
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Could not load Google Sign-In")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Google Sign-In"));
      document.head.appendChild(script);
    });
  }
  await googleScriptPromise;
  const google = (window as unknown as {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }).google;
  if (!google?.accounts?.id) return;
  if (!googleInitialized) {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        try {
          if (!authCountry.value) throw new Error("Select India or Pakistan before Google Sign-In");
          const data = await api("/api/auth/google", {
            method: "POST",
            body: JSON.stringify({ credential: response.credential, country: authCountry.value }),
          });
          token.value = data.token;
          localStorage.setItem("b9_token", data.token);
          user.value = data.user;
          signedIn.value = true;
          balance.value = data.user.balance;
          modal.value = null;
          startInboxPolling();
          notify(`Welcome, ${data.user.username}!`);
        } catch (error) {
          notify(error instanceof Error ? error.message : "Google sign-in failed");
        }
      },
    });
    googleInitialized = true;
  }
  const buttonParent = document.querySelector<HTMLElement>("#google-signin-button");
  if (buttonParent) {
    buttonParent.replaceChildren();
    google.accounts.id.renderButton(buttonParent, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: 280,
    });
  }
}
function setKycFile(field: "front" | "back" | "selfie", event: Event): void {
  const input = event.target as HTMLInputElement;
  kycFiles.value[field] = input.files?.[0];
}
function setPaymentProof(event: Event): void {
  const input = event.target as HTMLInputElement;
  paymentProof.value = input.files?.[0];
}
async function submitKyc(): Promise<void> {
  if (!signedIn.value) return;
  if (!kycCountry.value || !kycFullName.value || !kycDob.value || !kycDocumentType.value || !kycDocumentNumber.value) {
    notify("Complete all KYC fields");
    return;
  }
  if (!kycFiles.value.front || !kycFiles.value.selfie || (kycCountry.value === "PK" && kycDocumentType.value === "cnic" && !kycFiles.value.back)) {
    notify("Upload the required identity documents");
    return;
  }
  const form = new FormData();
  form.append("country", kycCountry.value);
  form.append("fullName", kycFullName.value);
  form.append("dateOfBirth", kycDob.value);
  form.append("documentType", kycDocumentType.value);
  form.append("documentNumber", kycDocumentNumber.value);
  form.append("address", kycAddress.value);
  if (kycFiles.value.front) form.append("front", kycFiles.value.front);
  if (kycFiles.value.back) form.append("back", kycFiles.value.back);
  if (kycFiles.value.selfie) form.append("selfie", kycFiles.value.selfie);
  kycLoading.value = true;
  try {
    const headers = new Headers();
    if (token.value) headers.set("Authorization", "Bearer " + token.value);
    const response = await fetch("/api/auth/kyc", { method: "POST", headers, body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "KYC submission failed");
    user.value = data.user;
    modal.value = null;
    notify("KYC submitted for admin review");
  } catch (error) {
    notify(error instanceof Error ? error.message : "KYC submission failed");
  } finally {
    kycLoading.value = false;
  }
}
async function submitAuth(): Promise<void> {
  authLoading.value = true;
  try {
    const path = authMode.value === "login" ? "/api/auth/login" : "/api/auth/register";
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify({
        username: authUsername.value,
        email: authEmail.value,
        password: authPassword.value,
        country: authMode.value === "register" ? authCountry.value : undefined,
      }),
    });
    token.value = data.token;
    localStorage.setItem("b9_token", data.token);
    user.value = data.user;
    signedIn.value = true;
    balance.value = data.user.balance;
    modal.value = null;
    startInboxPolling();
    authPassword.value = "";
    if (authMode.value === "register") authCountry.value = "";
    notify(authMode.value === "login" ? `Welcome back, ${data.user.username}!` : "Account created successfully");
  } catch (error) {
    notify(error instanceof Error ? error.message : "Authentication failed");
  } finally {
    authLoading.value = false;
  }
}
function toggleSignIn(): void {
  if (signedIn.value) {
    token.value = "";
    localStorage.removeItem("b9_token");
    signedIn.value = false;
    user.value = null;
    balance.value = 0;
    unreadCount.value = 0;
    inboxMessages.value = [];
    if (inboxTimer) clearInterval(inboxTimer);
    notify("Signed out");
  } else {
    authMode.value = "login";
    modal.value = "auth";
  }
}
function openProfile(): void {
  if (!requireSignIn()) modal.value = "profile";
}
async function openTransactionHistory(): Promise<void> {
  if (requireSignIn()) return;
  modal.value = "transactions";
  await loadWalletTransactions();
}
async function loadWalletTransactions(): Promise<void> {
  if (!signedIn.value) return;
  transactionLoading.value = true;
  try {
    const data = await api("/api/wallet/transactions");
    walletTransactions.value = data.transactions || [];
  } catch (error) {
    walletTransactions.value = [];
    notify(error instanceof Error ? error.message : "Could not load transaction history");
  } finally {
    transactionLoading.value = false;
  }
}
function openKyc(): void {
  if (requireSignIn()) return;
  modal.value = "kyc";
}
function showFavorites(): void {
  modal.value = "favorites";
}
function showAuth(): void {
  authMode.value = "login";
  modal.value = "auth";
}
</script>

<style>
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #355342;
  background: #e8f4e9;
  font-synthesis: none;
  font-optical-sizing: auto;
}
* { box-sizing: border-box; }
html { min-width: 320px; background: #e8f4e9; }
body { margin: 0; min-height: 100vh; }
button, input { font: inherit; }
button { cursor: pointer; }
.page-frame {
  width: min(100%, 480px);
  min-height: 100vh;
  margin: 0 auto;
  padding-bottom: calc(91px + env(safe-area-inset-bottom));
  overflow: hidden;
  background: #f6faf6;
  box-shadow: 0 0 36px rgb(34 91 51 / 8%);
}
.desktop-nav { display: none; }
.topbar {
  display: flex;
  height: 62px;
  align-items: center;
  gap: 7px;
  padding: 4px 12px 10px;
  color: white;
  background: #20b763;
}
.header-icon { display: grid; flex: 0 0 auto; place-items: center; padding: 0; border: 0; color: inherit; background: none; }
.menu-button { width: 25px; }
.public-brand {
  display: flex;
  width: 112px;
  min-width: 112px;
  height: 48px;
  flex: 0 0 112px;
  align-items: center;
  gap: 6px;
  color: white;
  text-decoration: none;
}
.brand-emblem {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border: 0;
  border-radius: 0;
  background: transparent;
  object-fit: contain;
}
.brand-wordmark {
  display: block;
  overflow: visible;
  white-space: nowrap;
  font-size: 17px;
  font-weight: 900;
  letter-spacing: -.6px;
}
.header-actions { display: flex; min-width: 0; flex: 1; align-items: center; justify-content: flex-end; gap: 5px; }
.balance-button, .deposit-button {
  display: flex;
  height: 38px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  border-radius: 12px;
  color: #344c3c;
  background: white;
  white-space: nowrap;
}
.balance-button { min-width: 0; padding: 0 7px; }
.wallet-icon { flex: 0 0 auto; color: #20aa5b; fill: #20aa5b; }
.balance-value { color: #b66b35; font-size: clamp(11px, 3.2vw, 14px); font-weight: 750; font-variant-numeric: tabular-nums; }
.add-icon { display: grid; width: 21px; height: 21px; flex: 0 0 auto; place-items: center; border-radius: 50%; color: white; background: #26b76b; }
.deposit-button { gap: 2px; padding: 0 8px; font-size: 12px; font-weight: 600; }
.search-button { width: 25px; }
.search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 9px 14px 12px;
  background: #20b763;
}
.search-input-icon, .clear-search { flex: 0 0 auto; color: #fff; }
.search-wrap input { width: 100%; padding: 9px 12px; border: 0; border-radius: 10px; outline: none; color: #273f31; background: #fff; }
.clear-search { display: grid; place-items: center; padding: 2px; border: 0; background: none; }
.content { display: flex; flex-direction: column; gap: 10px; padding: 9px 11px 16px; }
.promo-frame { padding: 8px; border-radius: 28px; background: #fff; box-shadow: 0 3px 12px rgb(32 98 51 / 5%); }
.hero { position: relative; min-height: 0; max-height: 320px; aspect-ratio: 393 / 168; overflow: hidden; border-radius: 20px; color: #fff; background: radial-gradient(circle at 85% 15%, rgb(91 206 115 / 50%), transparent 36%), linear-gradient(120deg, #075e35, #128647 68%, #20a85b); }
.hero::after { position: absolute; inset: 0; content: ""; background: linear-gradient(90deg, rgb(3 83 39 / 38%) 0%, transparent 58%); pointer-events: none; }
.hero-art { position: absolute; inset: 0 0 0 auto; width: 52%; height: 100%; object-fit: cover; object-position: center; mask-image: linear-gradient(90deg, transparent, #000 24%); }
.hero-creative-button { position: absolute; inset: 0; display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }
.hero-full-creative-image { display: block; width: 100%; height: 100%; object-fit: cover; }
.hero-full-creative::after { display: none; }
.hero-copy { position: relative; z-index: 1; display: flex; width: 100%; height: 100%; min-height: 0; max-width: 780px; flex-direction: column; align-items: flex-start; justify-content: center; padding: 12px clamp(14px, 5vw, 38px); text-shadow: 0 1px 5px rgb(0 56 24 / 25%); }
.hero-with-art .hero-copy { max-width: 58%; }
.hero-title { display: flex; align-items: baseline; gap: 7px; margin: 0; font-size: clamp(14px, 4.2vw, 20px); font-weight: 750; line-height: 1; }
.hero-title strong { font-size: clamp(28px, 9.5vw, 50px); font-weight: 900; letter-spacing: -1.5px; }
.hero-subtitle { max-width: 440px; margin: 5px 0 0; font-size: clamp(11px, 3.3vw, 15px); font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
.hero-amount { display: flex; flex-direction: column; margin: 6px 0 0; color: #ffe66d; font-size: clamp(17px, 5vw, 26px); font-weight: 900; line-height: 1.05; overflow-wrap: anywhere; }
.hero-amount small { margin-bottom: 2px; color: #acd59c; font-size: 9px; font-weight: 750; }
.claim-button { display: flex; width: fit-content; align-items: center; gap: 6px; margin-top: 5px; padding: 4px 6px 4px 11px; border: 0; border-radius: 99px; color: white; background: #28bf70; font-size: clamp(10px, 3.3vw, 14px); font-weight: 650; text-shadow: none; }
.claim-button > span { display: grid; width: 21px; height: 21px; place-items: center; border-radius: 50%; color: #229e5a; background: white; }
.hero-dots { position: absolute; z-index: 2; right: 16px; bottom: 7px; left: 16px; display: flex; justify-content: center; gap: 7px; }
.hero-dots button { width: 8px; height: 8px; padding: 0; border: 0; border-radius: 50%; background: rgb(255 255 255 / 55%); cursor: pointer; }
.hero-dots button.selected { width: 20px; border-radius: 9px; background: #fff; }
.welcome-banner { position: relative; display: flex; min-height: 220px; align-items: center; justify-content: space-between; gap: 16px; overflow: hidden; padding: clamp(18px, 5vw, 28px); border-radius: 20px; color: white; background: #075e35; }
.welcome-banner::before { position: absolute; z-index: 1; inset: 0; content: ""; background: linear-gradient(90deg, rgb(0 47 24 / 94%) 0%, rgb(0 47 24 / 79%) 45%, rgb(0 47 24 / 10%) 100%); pointer-events: none; }
.welcome-banner-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 42%; }
.welcome-banner-copy { position: relative; z-index: 2; max-width: 68%; }
.welcome-banner .eyebrow { color: #9af0b4; }
.welcome-banner h1 { margin: 6px 0; color: white; font-size: clamp(21px, 6vw, 32px); }
.welcome-banner p { max-width: 560px; margin: 0; color: rgb(255 255 255 / 88%); font-size: 13px; line-height: 1.5; }
.welcome-banner .primary-button { position: relative; z-index: 2; flex: 0 0 auto; }
.welcome-banner .primary-button { flex: 0 0 auto; }
.announcement { display: flex; min-height: 43px; align-items: center; gap: 10px; padding: 5px 7px 5px 14px; border-radius: 14px; color: #426d51; background: #e7f4e9; }
.announcement-volume { flex: 0 0 auto; color: #36a564; fill: #36a564; }
.announcement p { flex: 1; overflow: hidden; margin: 0; font-size: clamp(11px, 3.4vw, 14px); white-space: nowrap; text-overflow: ellipsis; }
.inbox-button { position: relative; display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border: 0; border-radius: 10px; color: white; background: #17a854; }
.inbox-badge { position: absolute; top: -6px; right: -7px; min-width: 18px; height: 18px; padding: 0 4px; border: 2px solid white; border-radius: 999px; color: white; background: #df3f4b; font-size: 9px; font-weight: 800; line-height: 14px; }
.categories { display: flex; min-height: 91px; align-items: center; padding: 6px 5px 4px; border-radius: 19px; background: white; box-shadow: 0 3px 13px rgb(27 88 47 / 5%); }
.category-arrow { display: grid; width: 24px; flex: 0 0 24px; place-items: center; padding: 0; border: 0; color: #8d9991; background: none; }
.category-list { display: flex; flex: 1; justify-content: space-around; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.category-list::-webkit-scrollbar { display: none; }
.category { display: flex; min-width: 51px; flex: 1; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; padding: 0; border: 0; color: #707b73; background: none; font-size: 12px; }
.category-icon { display: grid; height: 39px; place-items: center; color: #16994d; }
.category-image { width: 38px; height: 38px; object-fit: contain; }
.category:first-child .category-icon svg { fill: currentColor; stroke: #16994d; }
.category-label { padding: 0 3px 5px; border-bottom: 2px solid transparent; white-space: nowrap; }
.category.selected .category-label { border-color: #27a95c; color: #315940; font-weight: 700; }
.category-mark { display: grid; place-items: center; color: #13a356; font-size: 23px; font-weight: 900; line-height: 1; }
.category-mark.pg-slot { width: 30px; height: 30px; border-radius: 50% 50% 45% 45%; color: #fff; background: #18a657; font-size: 13px; letter-spacing: -1px; }
.spribe-mark { width: 56px; height: 29px; overflow: visible; fill: none; stroke: #129b50; stroke-width: 2; stroke-linecap: square; stroke-linejoin: miter; }
.spribe-mark > path:not(.digit-divider) { stroke-width: 2.8; }
.spribe-mark > .digit-divider { stroke-width: 1; }
.category-mark.inout { font-size: 23px; font-style: italic; letter-spacing: -3px; }
.pg-slot-mark { width: 34px; height: 34px; filter: drop-shadow(0 2px 2px rgb(21 142 74 / 12%)); }
.jackpot {
  position: relative;
  aspect-ratio: 3.16 / 1;
  overflow: hidden;
  border-radius: 16px;
  background: #eef8ee;
  box-shadow: 0 4px 12px rgb(38 124 69 / 7%);
}
.jackpot-banner {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  object-position: center;
}
.jackpot-value {
  position: absolute;
  z-index: 2;
  left: 50%;
  bottom: 24%;
  width: 52%;
  padding: 3px 6px;
  transform: translateX(-50%);
  color: #17683a;
  font-size: clamp(13px, 4vw, 21px);
  font-weight: 900;
  line-height: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.games-panel { padding: 9px 7px 10px; border-radius: 18px 18px 0 0; background: white; }
.section-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 4px 10px; }
.section-heading h2 { display: flex; align-items: center; gap: 7px; margin: 0; color: #385e46; font-size: 16px; font-weight: 750; }
.section-flame { color: #169b4d; }
.view-all { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border: 0; border-radius: 99px; color: #50765b; background: #edf6ed; font-size: 12px; }
.game-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.game-card { position: relative; aspect-ratio: .86; overflow: hidden; border-radius: 15px; background: #138841; cursor: pointer; isolation: isolate; }
.game-card > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .22s ease; }
.game-card:hover > img { transform: scale(1.04); }
.game-shade { position: absolute; z-index: 1; inset: 0; background: linear-gradient(180deg, rgb(0 25 10 / 16%) 0%, transparent 34%, rgb(0 24 12 / 44%) 100%); }
.game-card.fortune-card > img { filter: hue-rotate(290deg) saturate(1.3); }
.game-brand { position: absolute; z-index: 2; top: 9px; left: 8px; color: white; font-size: clamp(8px, 2.4vw, 11px); font-weight: 900; text-decoration: underline; text-shadow: 0 1px 3px rgb(0 0 0 / 40%); }
.game-art-title { position: absolute; z-index: 2; right: 3px; bottom: 27px; left: 3px; color: white; font-size: clamp(12px, 4vw, 20px); font-style: italic; font-weight: 1000; line-height: .95; text-align: center; text-shadow: 1px 2px 2px #1d2220, -1px -1px 1px rgb(255 255 255 / 55%); }
.game-name { position: absolute; z-index: 2; right: 4px; bottom: 7px; left: 4px; color: white; font-size: 12px; font-weight: 700; text-align: center; text-shadow: 0 1px 3px rgb(0 0 0 / 55%); }
.game-status { position: absolute; z-index: 3; top: 50%; left: 50%; padding: 6px 10px; border-radius: 999px; background: rgb(0 0 0 / 75%); color: white; font-size: 11px; font-weight: 700; transform: translate(-50%, -50%); }
.game-unavailable { cursor: not-allowed; }
.game-unavailable > img { filter: grayscale(.8) brightness(.65); }
.favorite-button { position: absolute; z-index: 3; top: 7px; right: 7px; display: grid; width: 27px; height: 27px; place-items: center; padding: 0; border: 0; border-radius: 50%; color: #267c48; background: white; box-shadow: 0 2px 6px rgb(0 0 0 / 12%); }
.empty-state { padding: 20px 0; color: #6d786f; text-align: center; font-size: 13px; }
.bottom-nav {
  position: fixed;
  z-index: 5;
  bottom: 0;
  left: 50%;
  display: flex;
  width: min(100%, 480px);
  min-height: 76px;
  align-items: flex-end;
  justify-content: space-around;
  padding: 8px 8px calc(7px + env(safe-area-inset-bottom));
  border-radius: 23px 23px 0 0;
  background: rgb(255 255 255 / 97%);
  box-shadow: 0 -3px 16px rgb(32 79 46 / 10%);
  transform: translateX(-50%);
}
.bottom-nav button { display: flex; min-width: 48px; flex-direction: column; align-items: center; gap: 3px; padding: 0; border: 0; color: #9da69f; background: none; font-size: 10px; }
.bottom-nav button > svg { stroke-width: 2; }
.bottom-nav button.active-nav { color: #159a4b; }
.bottom-nav .wallet-circle { display: grid; width: 53px; height: 53px; margin-top: -28px; margin-bottom: 1px; place-items: center; border-radius: 50%; color: #fff; background: #1caf58; box-shadow: 0 3px 8px rgb(29 126 62 / 20%); }
.modal-backdrop { position: fixed; z-index: 10; inset: 0; display: flex; align-items: flex-end; justify-content: center; background: rgb(17 35 23 / 55%); }
.modal-sheet { width: min(100%, 480px); max-height: 82vh; overflow-y: auto; padding: 18px 18px calc(28px + env(safe-area-inset-bottom)); border-radius: 25px 25px 0 0; background: white; }
.modal-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.modal-heading h2 { margin: 0; color: #315940; font-size: 19px; text-transform: capitalize; }
.close-button { display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: 50%; color: #59665d; background: #f0f5f0; }
.modal-content { display: flex; flex-direction: column; gap: 12px; }
.bonus-note { margin: 0; padding: 9px; border-radius: 9px; color: #267c36; background: #e5f3e3; font-size: 13px; }
.game-wallet-panel { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px; border: 1px solid #dce9df; border-radius: 10px; background: #f7fbf7; }
.game-wallet-panel > div { display: grid; gap: 3px; }
.game-wallet-panel strong { color: #315940; font-size: 13px; }
.game-wallet-panel small { color: #667469; font-size: 12px; }
.game-wallet-panel button { flex: 0 0 auto; padding: 9px 11px; border: 0; border-radius: 9px; color: white; background: #188546; font-size: 12px; font-weight: 700; }
.game-wallet-panel button:disabled { opacity: .6; }
.amount-options { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.amount-options button { padding: 9px 3px; border: 1px solid #d5ded6; border-radius: 9px; background: white; font-size: 13px; }
.amount-options button.chosen { border-color: #319d42; background: #e5f3e3; font-weight: 700; }
.amount-input { width: 100%; padding: 11px 14px; border: 1px solid #d5ded6; border-radius: 12px; outline-color: #27a95c; }
.manual-payment-details { padding: 11px; border-radius: 10px; background: #edf5ef; }
.manual-payment-details p { margin: 5px 0 0; font-size: 12px; overflow-wrap: anywhere; }
.manual-payment-details p span { color: #718076; }
.manual-payment-details small { display: block; margin-top: 7px; color: #667469; line-height: 1.45; }
.manual-note { width: 100%; resize: vertical; padding: 11px 14px; border: 1px solid #d5ded6; border-radius: 12px; font-family: inherit; outline-color: #27a95c; }
.payment-proof-label { display: flex; flex-direction: column; gap: 6px; color: #536358; font-size: 12px; }
.payment-proof-label input { min-height: 42px; padding: 7px; border: 1px dashed #d5ded6; border-radius: 10px; }
.primary-button { border: 0; border-radius: 999px; padding: 8px 14px; color: white; background: #23ae5e; font-weight: 650; }
.page-section { display: flex; flex-direction: column; gap: 14px; padding: 8px 2px 18px; }
.page-heading { padding: 12px 4px 4px; }
.page-heading h1 { margin: 4px 0 6px; color: #233d2d; font-size: clamp(26px, 7vw, 36px); letter-spacing: -.04em; }
.page-heading p { max-width: 560px; margin: 0; color: #748078; font-size: 14px; line-height: 1.5; }
.eyebrow { color: #23944f; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
.promotion-grid { display: grid; gap: 12px; }
.promotion-banner { position: relative; display: flex; min-height: 225px; align-items: center; overflow: hidden; border-radius: 18px; color: white; background: radial-gradient(circle at 85% 15%, rgb(91 206 115 / 50%), transparent 36%), linear-gradient(120deg, #075e35, #128647 68%, #20a85b); }
.promotion-banner::after { position: absolute; inset: 0; content: ""; background: linear-gradient(90deg, rgb(3 63 31 / 94%) 0%, rgb(3 63 31 / 78%) 46%, rgb(3 63 31 / 5%) 100%); pointer-events: none; }
.promotion-banner-art { position: absolute; inset: 0 0 0 auto; width: 55%; height: 100%; object-fit: cover; }
.promotion-full-creative { display: grid; min-height: 0; align-items: stretch; aspect-ratio: auto; background: transparent; }
.promotion-full-creative::after { display: none; }
.promotion-complete-link { position: relative; display: block; width: 100%; aspect-ratio: 393 / 168; padding: 0; border: 0; border-radius: 18px; overflow: hidden; background: transparent; cursor: pointer; }
.promotion-banner-complete { display: block; width: 100%; height: 100%; object-fit: cover; }
.promotion-full-details { padding: 16px; border: 1px solid #e6eee8; border-radius: 12px; background: white; }
.promotion-full-details h2 { margin: 0 0 6px; color: #284534; }
.promotion-full-details p { color: #728078; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.promotion-banner-copy { position: relative; z-index: 1; display: flex; width: min(64%, 700px); flex-direction: column; align-items: flex-start; padding: 22px clamp(18px, 5vw, 38px); }
.promotion-number { margin-bottom: 5px; color: #b7efc7; font-size: 10px; font-weight: 850; letter-spacing: .12em; }
.promotion-value { position: relative; z-index: 1; color: #ffe66d; font-size: clamp(22px, 5vw, 36px); font-weight: 900; }
.promotion-banner h2 { position: relative; z-index: 1; margin: 3px 0 4px; color: white; font-size: clamp(18px, 4vw, 26px); }
.promotion-banner p { margin: 0 0 8px; color: rgb(255 255 255 / 90%); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.promotion-amount { margin-bottom: 14px; color: #ad7432; font-size: 12px; font-weight: 750; }
.promotion-banner .promotion-terms { padding-top: 8px; border-top: 1px solid rgb(255 255 255 / 25%); font-size: 11px; }
.responsible-play-note { padding: 14px; border: 1px solid #e6e9d8; border-radius: 13px; color: #596449; background: #fbf9ed; }
.responsible-play-note strong { font-size: 13px; }
.responsible-play-note p { margin: 6px 0 0; font-size: 11px; line-height: 1.6; }
.auth-configuration-note { margin: 0; padding: 10px; border-radius: 9px; color: #758179; background: #f3f6f3; font-size: 11px; text-align: center; }
.wallet-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.wallet-summary { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 7px; padding: 15px; border: 1px solid #e1ebe2; border-radius: 16px; background: white; }
.wallet-summary > span { color: #738078; font-size: 12px; font-weight: 650; }
.wallet-summary > strong { color: #203d2a; font-size: clamp(18px, 5vw, 25px); overflow-wrap: anywhere; }
.wallet-summary > small { color: #8a968e; font-size: 11px; }
.main-wallet-summary { color: white; border: 0; background: linear-gradient(135deg, #148b48, #24b362); }
.main-wallet-summary > span, .main-wallet-summary > strong, .main-wallet-summary > small { color: white; }
.wallet-workspace { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid #e1ebe2; border-radius: 16px; background: white; }
.wallet-workspace-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.wallet-workspace-heading h2 { margin: 3px 0 0; color: #2b4534; font-size: 17px; }
.wallet-workspace .wallet-tabs { min-width: 150px; }
.wallet-workspace .wallet-tabs button { padding: 8px; }
.bonus-note { margin: 0; color: #758179; font-size: 12px; line-height: 1.45; }
.wallet-form { display: grid; gap: 9px; }
.text-action { padding: 5px 0; border: 0; color: #228b4b; background: none; font-size: 12px; font-weight: 750; text-align: left; }
.text-action:disabled { opacity: .6; }
.signed-out-card { display: flex; min-height: 240px; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 26px; border: 1px solid #e1ebe2; border-radius: 18px; background: white; text-align: center; }
.signed-out-card > svg { color: #259752; }
.signed-out-card h2 { margin: 2px 0 0; color: #2b4534; font-size: 19px; }
.signed-out-card p { max-width: 350px; margin: 0 0 6px; color: #748078; font-size: 13px; line-height: 1.5; }
.transaction-list { max-height: none; }
.account-card { display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px solid #e1ebe2; border-radius: 16px; background: white; }
.account-balance { display: flex; min-height: 64px; align-items: center; gap: 10px; padding: 12px 16px; border: 1px solid #d5e9d8; border-radius: 14px; color: #248b4b; background: linear-gradient(110deg, #f1fbf2, #ffffff); }
.account-balance > span { flex: 1; color: #617469; font-size: 13px; font-weight: 650; }
.account-balance > strong { color: #205a37; font-size: 18px; font-variant-numeric: tabular-nums; }
.account-avatar, .profile-avatar-preview { display: grid; overflow: hidden; flex: 0 0 auto; place-items: center; border-radius: 50%; color: white; background: #24a85a; font-weight: 800; }
.account-avatar { width: 60px; height: 60px; font-size: 24px; }
.account-avatar img, .profile-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.avatar-upload-button { display: flex; width: fit-content; min-height: 42px; align-items: center; justify-content: center; gap: 8px; padding: 8px 13px; border: 1px solid #d5e7d8; border-radius: 11px; color: #248b4b; background: white; font-size: 12px; font-weight: 700; cursor: pointer; }
.avatar-upload-button.uploading { opacity: .65; cursor: wait; }
.avatar-upload-button input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }
.profile-picture-editor { display: flex; flex-direction: column; align-items: center; gap: 9px; padding-bottom: 12px; border-bottom: 1px solid #e8eee8; }
.profile-avatar-preview { width: 88px; height: 88px; font-size: 36px; }
.upload-hint { color: #87948b; font-size: 11px; }
.account-identity { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.account-identity > span, .account-identity > small { overflow: hidden; color: #758179; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.account-identity > strong { overflow: hidden; color: #2b4534; text-overflow: ellipsis; }
.account-action-grid { display: grid; gap: 8px; }
.account-action-grid > button { display: flex; min-height: 66px; align-items: center; gap: 12px; padding: 11px 13px; border: 1px solid #e1ebe2; border-radius: 13px; color: #299251; background: white; text-align: left; }
.account-action-grid > button > span { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.account-action-grid strong { color: #2b4534; font-size: 13px; }
.account-action-grid small { overflow: hidden; color: #78847c; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.sign-out-button { display: flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; border: 1px solid #eddddd; border-radius: 12px; color: #a74d4d; background: #fff9f9; font-weight: 700; }
.full-button { width: 100%; padding: 12px; }
.menu-list, .message-list { margin: 0; padding: 0; list-style: none; }
.menu-list li + li, .message-list li + li { margin-top: 5px; }
.menu-list button { display: flex; width: 100%; align-items: center; gap: 12px; padding: 10px; border: 0; border-radius: 9px; color: #355342; text-align: left; background: white; }
.menu-list button:hover { background: #e5f3e3; }
.menu-list .menu-section-label {
  margin: 6px 4px 2px;
  padding: 0;
  color: #89958d;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.promo-list { gap: 8px; }
.promo-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px; border-radius: 12px; background: #e5f3e3; }
.promo-card p { margin: 3px 0 0; color: #707b73; font-size: 12px; }
.promo-card .primary-button { padding: 7px 12px; font-size: 12px; }
.profile-info p { margin: 0; font-size: 14px; }
.message-list { max-height: 460px; overflow-y: auto; }
.inbox-message { padding: 12px; border-radius: 10px; background: #f1f6f2; border-left: 3px solid #aebbb1; }
.inbox-message.unread { border-left-color: #22a95a; background: #e5f3e3; }
.inbox-message-heading { display: flex; justify-content: space-between; gap: 8px; }
.inbox-message-heading small { flex: 0 0 auto; color: #829087; font-size: 10px; }
.inbox-message p { margin: 6px 0 0; color: #607166; font-size: 12px; line-height: 1.45; }
.inbox-bet, .inbox-lottery, .inbox-game { border-left-color: #e7a52a; }
.transaction-list { max-height: 420px; overflow-y: auto; }
.transaction-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-radius: 11px; background: #edf5ef; }
.transaction-card > div { display: flex; flex-direction: column; gap: 3px; }
.transaction-card small { color: #7b887f; font-size: 11px; }
.transaction-result { align-items: flex-end; }
.transaction-result span { border-radius: 999px; padding: 3px 7px; font-size: 10px; text-transform: capitalize; background: #e7ece8; }
.transaction-result span.approved { color: #1d7a40; background: #d9f0df; }
.transaction-result span.rejected { color: #a33a3a; background: #f4dddd; }
.transaction-result span.pending { color: #886b20; background: #f5eccb; }
.favorites-list { gap: 8px; }
.favorite-game { display: flex; width: 100%; align-items: center; gap: 10px; padding: 8px; border: 1px solid #dce5de; border-radius: 11px; text-align: left; background: white; }
.favorite-game img { width: 54px; height: 54px; border-radius: 9px; object-fit: cover; }
.favorite-game span { display: flex; flex-direction: column; }
.favorite-game small { color: #839087; }
.support-content { gap: 8px; }
.support-content > p { margin: 0; color: #667469; font-size: 13px; }
.support-row { display: flex; width: 100%; align-items: center; gap: 10px; padding: 11px; border: 0; border-radius: 10px; text-align: left; background: #edf5ef; color: #355342; }
.support-row span { display: flex; flex-direction: column; }
.support-row small { color: #829087; }
.ticket-form { display: grid; gap: 7px; margin-top: 4px; }
.ticket-form input, .ticket-form textarea {
  width: 100%; border: 1px solid #dce7df; border-radius: 10px; background: white; color: #355342; outline: none;
}
.ticket-form input { height: 42px; padding: 0 11px; }
.ticket-form textarea { resize: vertical; padding: 10px 11px; font-family: inherit; }
.ticket-form input:focus, .ticket-form textarea:focus { border-color: #5dbb80; box-shadow: 0 0 0 3px rgb(50 153 93 / 8%); }
.maintenance-banner { margin-bottom: 10px; padding: 10px 12px; border: 1px solid #f1c76b; border-radius: 10px; color: #7a5710; background: #fff8e7; font-size: 12px; font-weight: 700; text-align: center; }
.toast { position: fixed; z-index: 20; bottom: 88px; left: 50%; max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 99px; color: white; background: #27382b; box-shadow: 0 4px 16px rgb(0 0 0 / 20%); text-align: center; font-size: 13px; transform: translateX(-50%); }
.wallet-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.wallet-tabs button { padding: 10px; border: 1px solid #d5ded6; border-radius: 10px; color: #536358; background: white; }
.wallet-tabs button.active { border-color: #25a95b; color: #1b7d43; background: #e7f4e9; font-weight: 750; }
.auth-form input { width: 100%; padding: 12px 14px; border: 1px solid #d5ded6; border-radius: 12px; outline-color: #27a95c; }
.primary-button:disabled { opacity: .65; cursor: wait; }
.auth-form select, .kyc-form select, .kyc-form input { width: 100%; min-height: 42px; padding: 10px 12px; border: 1px solid #d5ded6; border-radius: 10px; background: white; outline-color: #27a95c; }
.google-signin-button { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: center; }
.auth-divider { display: flex; align-items: center; gap: 8px; color: #718076; font-size: 11px; }
.auth-divider::before, .auth-divider::after { content: ""; height: 1px; flex: 1; background: #dfe7e0; }
.verification-row { display: grid; grid-template-columns: 92px 1fr 64px; gap: 7px; }
.verification-row input { width: 100%; min-height: 40px; padding: 8px; border: 1px solid #d5ded6; border-radius: 9px; }
.secondary-button, .verify-button { border: 0; border-radius: 9px; color: white; font-size: 12px; }
.secondary-button { background: #5b7965; } .verify-button { background: #23a85a; }
.kyc-note { margin: 0; padding: 9px; border-radius: 9px; color: #267c36; background: #e5f3e3; font-size: 12px; }
.kyc-form label { display: flex; flex-direction: column; gap: 5px; color: #536358; font-size: 12px; }
.kyc-form label input { padding: 7px; border-style: dashed; }
@media (max-width: 479px) {
  .amount-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .game-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .game-card { border-radius: 13px; }
  .game-art-title { font-size: clamp(16px, 5vw, 22px); }
  .game-name { font-size: 12px; }
  .verification-row { grid-template-columns: 1fr 1fr; }
  .verification-row input { grid-column: 1 / -1; }
  .modal-sheet { max-height: calc(100dvh - 12px); }
  .transaction-card { align-items: flex-start; }
  .account-card { gap: 9px; padding: 12px; }
  .account-card .text-action { flex: 0 0 auto; }
  .avatar-upload-button { max-width: 100%; }
  .inbox-message-heading { flex-wrap: wrap; }
  .promo-card { align-items: flex-start; }
  .welcome-banner { min-height: 245px; align-items: flex-start; flex-direction: column; justify-content: center; }
  .welcome-banner::before { background: linear-gradient(90deg, rgb(0 47 24 / 91%) 0%, rgb(0 47 24 / 76%) 52%, rgb(0 47 24 / 18%) 100%); }
  .welcome-banner-image { object-position: 60% center; }
  .welcome-banner-copy { max-width: 78%; }
  .bottom-nav { padding-right: max(8px, env(safe-area-inset-right)); padding-left: max(8px, env(safe-area-inset-left)); }
  .bottom-nav button { min-width: 48px; min-height: 48px; }
}
@media (min-width: 480px) {
  .page-frame { min-height: 100vh; }
}
@media (min-width: 760px) {
  body { background: #edf5ef; }
  .page-frame {
    width: min(1440px, 100%);
    margin: 0 auto;
    border-radius: 0;
  }
  .desktop-nav { position: sticky; top: 0; z-index: 4; display: flex; min-height: 58px; align-items: center; gap: 7px; padding: 0 clamp(20px, 4vw, 52px); border-bottom: 1px solid #e8eee8; background: rgb(255 255 255 / 97%); box-shadow: 0 3px 12px rgb(34 91 51 / 5%); }
  .desktop-nav button { min-height: 40px; padding: 9px 15px; border: 0; border-radius: 9px; color: #64736a; background: transparent; font-size: 14px; font-weight: 650; }
  .desktop-nav button.active { color: #168446; background: #eaf6ed; }
  .desktop-nav .desktop-auth { margin-left: auto; color: #fff; background: #22a85a; }
  .menu-button { display: none; }
  .topbar { height: 78px; gap: 14px; padding: 8px clamp(20px, 4vw, 52px) 12px; }
  .brand-emblem { width: 44px; height: 44px; flex-basis: 44px; }
  .public-brand { width: 150px; min-width: 150px; flex-basis: 150px; gap: 9px; }
  .brand-wordmark { font-size: 23px; }
  .header-actions { max-width: 420px; gap: 8px; }
  .balance-button, .deposit-button { height: 42px; }
  .search-wrap { padding-right: clamp(20px, 4vw, 52px); padding-left: clamp(20px, 4vw, 52px); }
  .content { gap: 18px; padding: 20px clamp(20px, 4vw, 52px) 36px; }
  .promo-frame { padding: 10px; }
  .hero { height: clamp(280px, 27vw, 380px); min-height: 280px; max-height: none; aspect-ratio: auto; }
  .hero-copy { min-height: 0; padding-right: clamp(24px, 5vw, 64px); padding-left: clamp(24px, 5vw, 64px); }
  .hero-title { font-size: clamp(20px, 2.2vw, 30px); }
  .hero-title strong { font-size: clamp(40px, 5vw, 68px); }
  .hero-subtitle { font-size: clamp(14px, 1.3vw, 18px); }
  .hero-with-art .hero-copy { max-width: 64%; }
  .hero-art { width: 48%; object-position: center; }
  .welcome-banner { min-height: clamp(280px, 28vw, 380px); padding: clamp(28px, 5vw, 64px); }
  .welcome-banner-copy { max-width: 58%; }
  .welcome-banner h1 { font-size: clamp(34px, 4vw, 54px); }
  .welcome-banner p { font-size: 16px; }
  .categories { min-height: 112px; padding-right: 18px; padding-left: 18px; }
  .category-list { justify-content: center; gap: clamp(12px, 2vw, 28px); }
  .category { max-width: 140px; min-width: 80px; }
  .category-image { width: 50px; height: 50px; }
  .category-label { font-size: 13px; }
  .jackpot { max-height: 400px; }
  .game-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
  .game-card { border-radius: 18px; }
  .games-panel { padding: 16px 14px 14px; }
  .section-heading { margin-bottom: 14px; }
  .section-heading h2 { font-size: 19px; }
  .promotion-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
  .account-action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .modal-backdrop { align-items: center; }
  .modal-sheet { width: min(640px, calc(100% - 48px)); max-height: 88vh; border-radius: 24px; }
  .bottom-nav { display: none; }
  .page-frame { padding-bottom: 20px; }
  .promotion-banner { min-height: 270px; align-items: flex-start; }
  .promotion-full-creative { min-height: 0; }
  .promotion-banner-art { width: 52%; }
  .promotion-banner-copy { width: 76%; padding: 16px; }
  .wallet-summary-grid { gap: 14px; }
  .page-section { gap: 18px; padding-right: 4px; padding-left: 4px; }
}
@media (min-width: 1100px) {
  .game-grid { grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); }
}
@media (max-width: 370px) {
  .topbar { gap: 4px; padding-right: 8px; padding-left: 8px; }
  .menu-button { width: 23px; }
  .public-brand { width: 74px; min-width: 74px; flex-basis: 74px; }
  .brand-emblem { width: 34px; height: 34px; flex-basis: 34px; }
  .brand-wordmark { font-size: 14px; }
  .header-actions { gap: 4px; }
  .balance-button { gap: 4px; padding: 0 5px; }
  .deposit-button { gap: 0; padding: 0 6px; font-size: 11px; }
  .search-button { width: 22px; }
  .search-button svg { width: 21px; }
  .content { gap: 8px; padding-right: 7px; padding-left: 7px; }
  .categories { min-height: 82px; }
  .category { min-width: 46px; font-size: 11px; }
  .jackpot { border-radius: 14px; }
  .jackpot-value { bottom: 24%; font-size: 12px; }
  .game-grid { gap: 8px; }
  .wallet-summary-grid { grid-template-columns: 1fr; }
  .wallet-workspace-heading { align-items: flex-start; flex-direction: column; }
  .wallet-workspace .wallet-tabs { width: 100%; }
}
@media (max-width: 350px) {
  .public-brand { width: 40px; min-width: 40px; flex-basis: 40px; }
  .brand-wordmark { display: none; }
  .deposit-button { display: none; }
}
</style>
