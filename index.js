import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // ← 追加ユーザー検証に必須
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ===== Keepalive（Northflank用） =====
const app = express();
app.get('/keepalive', (_, res) => res.send('ok'));
app.listen(process.env.PORT || 3000, () => console.log('Keepalive server running'));

// ===== Ready =====
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ===== 管理者設置用コマンド =====
client.on('messageCreate', async (message) => {
  if (message.content === '!setup-button') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup-button')
        .setLabel('チャンネル申請')
        .setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({
      content: 'プライベートチャンネルを申請するには下のボタンを押してください。',
      components: [row],
    });
  }
});

// ===== インタラクション処理 =====
client.on('interactionCreate', async (interaction) => {
  try {
    // ボタン → モーダル表示
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
        .setLabel('追加するユーザーID（任意・カンマ/空白区切り）')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('123456789012345678, 234567890123456789');

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(idsInput),
      );

      return interaction.showModal(modal);
    }

    // モーダル送信 → チャンネル作成
    if (interaction.isModalSubmit() && interaction.customId === 'channel-request-modal') {
      await interaction.deferReply({ ephemeral: true });

      const channelName = interaction.fields.getTextInputValue('channel-name').trim();
      const rawIds = (interaction.fields.getTextInputValue('member-ids') || '').trim();

      const catId = process.env.PRIVATE_CATEGORY_ID?.trim();
      if (!catId) return interaction.editReply('環境変数 PRIVATE_CATEGORY_ID が未設定です。');

      const cat = interaction.guild.channels.cache.get(catId);
      if (!cat || cat.type !== ChannelType.GuildCategory) {
        return interaction.editReply('PRIVATE_CATEGORY_ID がカテゴリではありません。');
      }

      // ===== ユーザーID整形 =====
      const requestedIds = rawIds
        ? rawIds
            .split(/[\s,、]+/)
            .map(s => s.replace(/[<@!>]/g, '').trim())  // <@123> 形式にも対応
            .filter(Boolean)
            .filter(id => /^\d{17,21}$/.test(id))
            .filter(id => id !== interaction.user.id)
        : [];

      // ===== ギルドで存在確認 =====
      let validMemberIds = [];
      if (requestedIds.length) {
        const results = await Promise.allSettled(
          requestedIds.map(id => interaction.guild.members.fetch(id))
        );
        validMemberIds = results
          .filter(r => r.status === 'fulfilled')
          .map(r => r.value.user.id);
      }
      const invalidIds = requestedIds.filter(id => !validMemberIds.includes(id));

      // ===== 権限設定 =====
      const permissionOverwrites = [
        { id: interaction.guild.roles.everyone.id, deny:  [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        ...validMemberIds.map(uid => ({
          id: uid,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        })),
      ];

      // ===== チャンネル作成 =====
      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: catId,
        permissionOverwrites,
      });

      // ===== レスポンス =====
      await interaction.editReply(
        `✅ チャンネル <#${channel.id}> を作成しました。\n` +
        (validMemberIds.length ? `追加メンバー: ${validMemberIds.map(id => `<@${id}>`).join(', ')}` : '追加メンバー: なし') +
        (invalidIds.length ? `\n⚠️ サーバーに存在しない/不正なID: ${invalidIds.join(', ')}` : '')
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

// ===== Login =====
client.login(process.env.DISCORD_TOKEN);