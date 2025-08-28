import {
  Client, GatewayIntentBits, Partials,
  ChannelType, PermissionsBitField,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // ← 名前/ハンドル解決に必要
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// keepalive（公開不要）
const app = express();
app.get('/keepalive', (_, res) => res.send('ok'));
app.listen(process.env.PORT || 3000, () => console.log('Keepalive server running'));

client.once('ready', () => console.log(`✅ Logged in as ${client.user.tag}`));

// 管理者用セットアップ
client.on('messageCreate', async (message) => {
  if (message.content === '!setup-button') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup-button').setLabel('チャンネル申請').setStyle(ButtonStyle.Primary)
    );
    await message.channel.send({
      content: 'プライベートチャンネルを申請するには下のボタンを押してください。',
      components: [row],
    });
  }
});

// 文字列トークン → ユーザーID配列に解決
const mentionIdRe = /^<@!?(\d{17,21})>$/;
const idRe = /^\d{17,21}$/;
async function resolveTokenToMemberIds(guild, token) {
  // 1) メンション <@...>
  const m = token.match(mentionIdRe);
  if (m) {
    try { const gm = await guild.members.fetch(m[1]); return [gm.user.id]; } catch { return []; }
  }
  // 2) 純ID
  if (idRe.test(token)) {
    try { const gm = await guild.members.fetch(token); return [gm.user.id]; } catch { return []; }
  }
  // 3) ハンドル/表示名（tangdoufu0703 など）
  const q = token.slice(0, 32); // searchは32文字上限
  try {
    // 前方一致で検索→厳密一致優先
    const res = await guild.members.search({ query: q, limit: 10 });
    if (res.size) {
      const lower = token.toLowerCase();
      const exact = res.find(gm =>
        gm.user.username?.toLowerCase() === lower ||               // ユーザー名（ハンドル）
        gm.user.globalName?.toLowerCase() === lower ||             // グローバル表示名
        gm.displayName?.toLowerCase() === lower ||                 // サーバー表示名
        gm.nickname?.toLowerCase() === lower
      );
      return [(exact ?? res.first()).user.id];
    }
  } catch { /* 権限不足/該当なしでも無視 */ }

  // キャッシュからも一応探す（フォールバック）
  const lower = token.toLowerCase();
  const cached = guild.members.cache.find(gm =>
    gm.user.username?.toLowerCase() === lower ||
    gm.user.globalName?.toLowerCase() === lower ||
    gm.displayName?.toLowerCase() === lower ||
    gm.nickname?.toLowerCase() === lower
  );
  return cached ? [cached.user.id] : [];
}

client.on('interactionCreate', async (interaction) => {
  try {
    // ボタン→モーダル
    if (interaction.isButton() && interaction.customId === 'setup-button') {
      const modal = new ModalBuilder()
        .setCustomId('channel-request-modal')
        .setTitle('プライベートチャンネル申請');

      const nameInput = new TextInputBuilder()
        .setCustomId('channel-name')
        .setLabel('チャンネル名')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const idsInput = new TextInputBuilder()
        .setCustomId('member-ids')
        .setLabel('追加ユーザー（@mention / 数値ID / ハンドル名、カンマ/空白区切り）')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('@tangdoufu0703, 123456789012345678, Miku');

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(idsInput),
      );
      return interaction.showModal(modal);
    }

    // モーダル送信→作成
    if (interaction.isModalSubmit() && interaction.customId === 'channel-request-modal') {
      await interaction.deferReply({ ephemeral: true });

      const channelName = interaction.fields.getTextInputValue('channel-name').trim();
      const raw = (interaction.fields.getTextInputValue('member-ids') || '').trim();

      const catId = process.env.PRIVATE_CATEGORY_ID?.trim();
      if (!catId) return interaction.editReply('環境変数 PRIVATE_CATEGORY_ID が未設定です。');

      const cat = interaction.guild.channels.cache.get(catId);
      if (!cat || cat.type !== ChannelType.GuildCategory) {
        return interaction.editReply('PRIVATE_CATEGORY_ID がカテゴリではありません。');
      }

      // 入力トークンの分割
      const tokens = raw ? raw.split(/[\s,、]+/).map(s => s.trim()).filter(Boolean) : [];

      // 解決 → 重複排除＆申請者除外
      let resolvedIds = [];
      for (const t of tokens) {
        const ids = await resolveTokenToMemberIds(interaction.guild, t);
        for (const id of ids) if (id !== interaction.user.id && !resolvedIds.includes(id)) resolvedIds.push(id);
      }

      // 付与権限
      const permissionOverwrites = [
        { id: interaction.guild.roles.everyone.id, deny:  [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id,                  allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        ...resolvedIds.map(uid => ({
          id: uid,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        })),
      ];

      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: catId,
        permissionOverwrites,
      });

      await interaction.editReply(
        `✅ <#${channel.id}> を作成しました。\n` +
        (resolvedIds.length ? `追加: ${resolvedIds.map(id => `<@${id}>`).join(', ')}` : '追加: なし')
      );
    }
  } catch (e) {
    console.error(e);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`❌ エラー: ${e.message ?? e}`);
    } else {
      await interaction.reply({ content: `❌ エラー: ${e.message ?? e}`, ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
