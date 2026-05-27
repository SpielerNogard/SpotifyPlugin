<template>
  <v-container class="spotify-config">
    <v-card class="mx-auto" max-width="600">
      <v-card-title class="text-h5 spotify-header">
        <v-icon class="mr-2">mdi-spotify</v-icon>
        {{ $t('Config.Title') }}
      </v-card-title>

      <v-tabs v-model="activeTab" bg-color="transparent" grow>
        <v-tab value="setup" prepend-icon="mdi-cog-outline">{{ $t('Config.Tabs.Setup') }}</v-tab>
        <v-tab value="settings" prepend-icon="mdi-tune">{{ $t('Config.Tabs.Settings') }}</v-tab>
        <v-tab value="logs" prepend-icon="mdi-text-box-search-outline">{{ $t('Config.Tabs.Logs') }}</v-tab>
      </v-tabs>

      <v-window v-model="activeTab">
        <v-window-item value="setup">
          <v-stepper v-model="currentStep" :items="stepItems" alt-labels>
            <template v-slot:item.1>
              <v-card flat>
                <v-card-text>
                  <p class="text-body-1 mb-4">{{ $t('Config.Step1.Description') }}</p>
                  <v-alert type="info" variant="tonal" class="mb-4">
                    <pre class="instructions">{{ $t('Config.Step1.Instructions') }}</pre>
                    <v-chip color="primary" class="mt-2 mr-2" label>
                      {{ redirectUri }}
                    </v-chip>
                    <v-chip
                      color="secondary"
                      class="mt-2"
                      label
                      append-icon="mdi-content-copy"
                      @click="copyToClipboard(spotifyDashboardUrl)"
                    >
                      {{ spotifyDashboardUrl }}
                    </v-chip>
                  </v-alert>

                  <v-btn
                    color="#1DB954"
                    variant="elevated"
                    @click="openSpotifyDashboard"
                    prepend-icon="mdi-open-in-new"
                  >
                    {{ $t('Config.Step1.Button') }}
                  </v-btn>
                </v-card-text>
              </v-card>
            </template>

            <template v-slot:item.2>
              <v-card flat>
                <v-card-text>
                  <p class="text-body-1 mb-4">{{ $t('Config.Step2.Description') }}</p>
                  <v-text-field
                    v-model="config.clientId"
                    :label="$t('Config.Step2.ClientId')"
                    variant="outlined"
                    class="mb-3"
                    hide-details
                  />
                  <v-text-field
                    v-model="config.clientSecret"
                    :label="$t('Config.Step2.ClientSecret')"
                    variant="outlined"
                    class="mb-3"
                    type="password"
                    hide-details
                  />
                  <v-text-field
                    v-model="config.redirectUri"
                    :label="$t('Config.Step2.RedirectUri')"
                    variant="outlined"
                    hide-details
                  />
                </v-card-text>
              </v-card>
            </template>

            <template v-slot:item.3>
              <v-card flat>
                <v-card-text>
                  <p class="text-body-1 mb-4">{{ $t('Config.Step3.Description') }}</p>

                  <v-alert
                    :type="isConnected ? 'success' : 'warning'"
                    variant="tonal"
                    class="mb-4"
                  >
                    <div class="d-flex align-center">
                      <span>{{ isConnected ? $t('Config.Step3.Connected') : $t('Config.Step3.NotConnected') }}</span>
                      <span v-if="isConnected && userName" class="ml-2">- {{ userName }}</span>
                    </div>
                  </v-alert>

                  <v-btn
                    v-if="!isConnected"
                    color="#1DB954"
                    variant="elevated"
                    @click="connectSpotify"
                    :loading="isConnecting"
                    prepend-icon="mdi-spotify"
                  >
                    {{ $t('Config.Step3.Button') }}
                  </v-btn>
                </v-card-text>
              </v-card>
            </template>

            <template v-slot:actions>
              <v-stepper-actions
                @click:prev="currentStep--"
                @click:next="handleNext"
                :prev-text="$t('Config.Back')"
                :next-text="currentStep === 3 ? $t('Config.Save') : $t('Config.Next')"
                :disabled="nextDisabled"
              />
            </template>
          </v-stepper>
        </v-window-item>

        <v-window-item value="settings">
          <v-card flat>
            <v-card-text>
              <v-alert
                v-if="!isConnected"
                type="warning"
                variant="tonal"
                class="mb-4"
                density="compact"
              >
                {{ $t('Config.Settings.AuthBanner') }}
              </v-alert>

              <v-alert
                v-if="rateLimitedUntil"
                type="warning"
                variant="tonal"
                class="mb-4"
                density="compact"
                icon="mdi-clock-alert-outline"
              >
                {{ rateLimitedMessage }}
              </v-alert>

              <div class="text-subtitle-1 mb-2">{{ $t('Config.Settings.PollInterval') }}</div>
              <v-slider
                v-model="settings.pollIntervalMs"
                :min="1000"
                :max="10000"
                :step="500"
                thumb-label
                :ticks="{ 1000: '1s', 2000: '2s', 5000: '5s', 10000: '10s' }"
                show-ticks="always"
                tick-size="4"
              >
                <template v-slot:append>
                  <span class="text-body-2 ml-2" style="min-width: 50px;">
                    {{ (settings.pollIntervalMs / 1000).toFixed(1) }}s
                  </span>
                </template>
              </v-slider>
              <p class="text-caption text-medium-emphasis mb-4">{{ $t('Config.Settings.PollIntervalHint') }}</p>

              <v-divider class="my-4" />

              <div class="d-flex align-center mb-4">
                <v-icon :color="isConnected ? 'success' : 'warning'" class="mr-2">
                  {{ isConnected ? 'mdi-check-circle' : 'mdi-alert-circle' }}
                </v-icon>
                <span class="text-body-1">
                  {{ isConnected ? $t('Config.Step3.Connected') : $t('Config.Step3.NotConnected') }}
                  <span v-if="isConnected && userName">- {{ userName }}</span>
                </span>
                <v-spacer />
                <v-btn
                  v-if="isConnected"
                  size="small"
                  color="error"
                  variant="outlined"
                  @click="disconnectSpotify"
                  prepend-icon="mdi-logout"
                >
                  {{ $t('Config.Step3.Disconnect') }}
                </v-btn>
              </div>

              <v-btn
                color="primary"
                variant="elevated"
                :disabled="!settingsDirty"
                @click="saveSettings"
                prepend-icon="mdi-content-save"
              >
                {{ $t('Config.Settings.Save') }}
              </v-btn>
            </v-card-text>
          </v-card>
        </v-window-item>

        <v-window-item value="logs">
          <v-card flat>
            <v-card-text>
              <div class="d-flex align-center flex-wrap ga-2 mb-3">
                <v-select
                  v-model="logLevel"
                  :items="logLevelItems"
                  :label="$t('Config.Logs.Filter')"
                  density="compact"
                  variant="outlined"
                  hide-details
                  style="max-width: 160px;"
                />
                <v-switch
                  v-model="logAutoRefresh"
                  :label="$t('Config.Logs.AutoRefresh')"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                />
                <v-spacer />
                <v-btn size="small" variant="text" @click="fetchLogs" prepend-icon="mdi-refresh">
                  {{ $t('Config.Logs.Refresh') }}
                </v-btn>
                <v-btn size="small" variant="text" @click="copyLogs" prepend-icon="mdi-content-copy">
                  {{ $t('Config.Logs.Copy') }}
                </v-btn>
                <v-btn size="small" variant="text" color="warning" @click="clearLogs" prepend-icon="mdi-delete">
                  {{ $t('Config.Logs.Clear') }}
                </v-btn>
                <v-btn size="small" variant="text" @click="openLogFolder" prepend-icon="mdi-folder-open">
                  {{ $t('Config.Logs.OpenFolder') }}
                </v-btn>
              </div>

              <v-card variant="outlined" class="log-box">
                <pre v-if="logLines.length" ref="logPre" class="log-content">{{ logText }}</pre>
                <div v-else class="pa-4 text-center text-medium-emphasis">
                  {{ $t('Config.Logs.Empty') }}
                </div>
              </v-card>
            </v-card-text>
          </v-card>
        </v-window-item>
      </v-window>
    </v-card>
  </v-container>
</template>

<script>
export default {
  name: 'ConfigPage',
  data() {
    return {
      activeTab: 'setup',
      currentStep: 1,
      config: {
        clientId: '',
        clientSecret: '',
        redirectUri: 'http://127.0.0.1:8888/callback'
      },
      isConnected: false,
      isConnecting: false,
      userName: '',
      spotifyDashboardUrl: 'https://developer.spotify.com/dashboard',
      settings: {
        pollIntervalMs: 2000,
      },
      settingsLoaded: { pollIntervalMs: 2000 },
      rateLimitedUntil: 0,
      statusPollTimer: null,
      logLines: [],
      logLevel: 'all',
      logAutoRefresh: true,
      logRefreshTimer: null,
    };
  },
  computed: {
    stepItems() {
      return [
        { title: this.$t('Config.Step1.Title'), value: 1 },
        { title: this.$t('Config.Step2.Title'), value: 2 },
        { title: this.$t('Config.Step3.Title'), value: 3 }
      ];
    },
    redirectUri() {
      return this.config.redirectUri || 'http://127.0.0.1:8888/callback';
    },
    nextDisabled() {
      if (this.currentStep === 2) {
        return !this.config.clientId || !this.config.clientSecret;
      }
      return false;
    },
    settingsDirty() {
      return this.settings.pollIntervalMs !== this.settingsLoaded.pollIntervalMs;
    },
    rateLimitedMessage() {
      if (!this.rateLimitedUntil) return '';
      const t = new Date(this.rateLimitedUntil).toLocaleTimeString();
      return this.$t('Config.Settings.RateLimited', { time: t });
    },
    logLevelItems() {
      return [
        { title: this.$t('Config.Logs.LevelAll'), value: 'all' },
        { title: this.$t('Config.Logs.LevelInfo'), value: 'info' },
        { title: this.$t('Config.Logs.LevelWarn'), value: 'warn' },
        { title: this.$t('Config.Logs.LevelError'), value: 'error' },
      ];
    },
    logText() {
      return this.logLines.join('\n');
    },
  },
  methods: {
    async openSpotifyDashboard() {
      try {
        await this.$fd.sendToBackend({
          action: 'openUrl',
          url: this.spotifyDashboardUrl
        });
      } catch (error) {
        this.$fd.error('Failed to open URL: ' + error.message);
      }
    },
    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.$fd.info('Copied to clipboard');
      } catch (error) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        this.$fd.info('Copied to clipboard');
      }
    },
    async handleNext() {
      if (this.currentStep === 2) {
        // Save credentials before moving to step 3
        await this.saveConfig();
      }
      if (this.currentStep === 3) {
        // Final save
        await this.saveConfig();
        return;
      }
      this.currentStep++;
    },
    async saveConfig() {
      try {
        await this.$fd.sendToBackend({
          action: 'saveConfig',
          data: {
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
            redirectUri: this.config.redirectUri
          }
        });
        this.$fd.info('Configuration saved');
      } catch (error) {
        this.$fd.error('Failed to save configuration: ' + error.message);
      }
    },
    async connectSpotify() {
      if (!this.config.clientId || !this.config.clientSecret) {
        this.$fd.error('Please enter Client ID and Client Secret first');
        return;
      }

      this.isConnecting = true;
      try {
        const response = await this.$fd.sendToBackend({
          action: 'startOAuth'
        });
        
        if (response && response.success) {
          // Backend will open the login URL in system browser
          // Poll for connection status
          this.pollConnectionStatus();
        } else {
          this.$fd.error('Failed to start OAuth: ' + (response?.error || 'Unknown error'));
          this.isConnecting = false;
        }
      } catch (error) {
        this.$fd.error('Failed to start OAuth: ' + error.message);
        this.isConnecting = false;
      }
    },
    async pollConnectionStatus() {
      const maxAttempts = 60; // 60 seconds timeout
      let attempts = 0;
      
      const checkStatus = async () => {
        try {
          const response = await this.$fd.sendToBackend({
            action: 'checkConnection'
          });
          
          if (response && response.connected) {
            this.isConnected = true;
            this.userName = response.userName || '';
            this.isConnecting = false;
            return;
          }
          
          attempts++;
          if (attempts < maxAttempts && this.isConnecting) {
            setTimeout(checkStatus, 1000);
          } else {
            this.isConnecting = false;
          }
        } catch (error) {
          this.isConnecting = false;
        }
      };
      
      checkStatus();
    },
    async disconnectSpotify() {
      try {
        await this.$fd.sendToBackend({
          action: 'disconnect'
        });
        this.isConnected = false;
        this.userName = '';
      } catch (error) {
        this.$fd.error('Failed to disconnect: ' + error.message);
      }
    },
    async loadConfig() {
      try {
        const response = await this.$fd.sendToBackend({
          action: 'getConfig'
        });

        if (response) {
          this.config.clientId = response.clientId || '';
          this.config.clientSecret = response.clientSecret || '';
          this.config.redirectUri = response.redirectUri || 'http://127.0.0.1:8888/callback';
          this.isConnected = response.connected || false;
          this.userName = response.userName || '';
        }
      } catch (error) {
        this.$fd.error('Failed to load configuration: ' + error.message);
      }
    },
    async fetchStatus() {
      try {
        const status = await this.$fd.sendToBackend({ action: 'getStatus' });
        if (status) {
          this.rateLimitedUntil = status.rateLimitedUntil || 0;
          if (status.pollIntervalMs && this.settings.pollIntervalMs === this.settingsLoaded.pollIntervalMs) {
            this.settings.pollIntervalMs = status.pollIntervalMs;
            this.settingsLoaded.pollIntervalMs = status.pollIntervalMs;
          }
          this.isConnected = !!status.authenticated;
          if (status.userName) this.userName = status.userName;
        }
      } catch (err) {
        // ignore — status is best-effort
      }
    },
    startStatusPoll() {
      this.stopStatusPoll();
      this.fetchStatus();
      this.statusPollTimer = setInterval(() => this.fetchStatus(), 5000);
    },
    stopStatusPoll() {
      if (this.statusPollTimer) {
        clearInterval(this.statusPollTimer);
        this.statusPollTimer = null;
      }
    },
    async fetchLogs() {
      const pinnedToBottom = this.isLogPinnedToBottom();
      try {
        const res = await this.$fd.sendToBackend({
          action: 'getLogs',
          data: { lines: 200, level: this.logLevel === 'all' ? null : this.logLevel },
        });
        this.logLines = res?.logs || [];
        if (pinnedToBottom) {
          this.$nextTick(() => this.scrollLogsToBottom());
        }
      } catch (err) {
        this.$fd.error('Failed to load logs: ' + err.message);
      }
    },
    isLogPinnedToBottom() {
      const pre = this.$refs.logPre;
      if (!pre) return true;   // first render: scroll
      // Within ~20px of bottom counts as "at bottom"
      return pre.scrollHeight - pre.scrollTop - pre.clientHeight < 20;
    },
    scrollLogsToBottom() {
      const pre = this.$refs.logPre;
      if (pre) pre.scrollTop = pre.scrollHeight;
    },
    async copyLogs() {
      try {
        await navigator.clipboard.writeText(this.logLines.join('\n'));
        this.$fd.info(this.$t('Config.Logs.Copied'));
      } catch (err) {
        this.$fd.error('Failed to copy: ' + err.message);
      }
    },
    async clearLogs() {
      try {
        await this.$fd.sendToBackend({ action: 'clearLogs' });
        this.logLines = [];
        this.$fd.info(this.$t('Config.Logs.Cleared'));
      } catch (err) {
        this.$fd.error('Failed to clear logs: ' + err.message);
      }
    },
    async openLogFolder() {
      try {
        await this.$fd.sendToBackend({ action: 'openLogFolder' });
      } catch (err) {
        this.$fd.error('Failed to open folder: ' + err.message);
      }
    },
    startLogRefresh() {
      this.stopLogRefresh();
      this.fetchLogs();
      if (this.logAutoRefresh) {
        this.logRefreshTimer = setInterval(() => this.fetchLogs(), 3000);
      }
    },
    stopLogRefresh() {
      if (this.logRefreshTimer) {
        clearInterval(this.logRefreshTimer);
        this.logRefreshTimer = null;
      }
    },
    async saveSettings() {
      try {
        const res = await this.$fd.sendToBackend({
          action: 'saveSettings',
          data: { pollIntervalMs: this.settings.pollIntervalMs },
        });
        if (res?.success) {
          this.settingsLoaded.pollIntervalMs = res.pollIntervalMs;
          this.settings.pollIntervalMs = res.pollIntervalMs;
          this.$fd.info(this.$t('Config.Settings.Saved'));
        }
      } catch (err) {
        this.$fd.error('Failed to save settings: ' + err.message);
      }
    },
  },
  watch: {
    activeTab(newVal) {
      if (newVal === 'settings') {
        this.startStatusPoll();
      } else {
        this.stopStatusPoll();
      }
      if (newVal === 'logs') {
        this.startLogRefresh();
      } else {
        this.stopLogRefresh();
      }
    },
    logAutoRefresh(newVal) {
      if (this.activeTab === 'logs') {
        if (newVal) this.startLogRefresh();
        else this.stopLogRefresh();
      }
    },
    logLevel() {
      if (this.activeTab === 'logs') this.fetchLogs();
    },
  },
  mounted() {
    this.$fd.info('Spotify Config Page loaded');
    this.loadConfig();
    this.fetchStatus();
  },
  beforeUnmount() {
    this.stopStatusPoll();
    this.stopLogRefresh();
  },
};
</script>

<style scoped>
.spotify-config {
  padding: 16px;
}

.spotify-header {
  background: linear-gradient(135deg, #1DB954 0%, #191414 100%);
  color: white;
}

.instructions {
  white-space: pre-wrap;
  font-family: inherit;
  margin: 0;
}

.log-box {
  background-color: #1a1a1a;
  max-height: 400px;
  overflow: hidden;
}

.log-content {
  margin: 0;
  padding: 12px;
  font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
  font-size: 11px;
  line-height: 1.4;
  color: #e0e0e0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 400px;
  overflow-y: auto;
}
</style>

