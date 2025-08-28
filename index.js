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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ===== Keepalive用（公開不要） =====
const app = express();
app.get('/keepalive', (_, res) => res.send('ok'));
app.listen(process.env.PORT || 3000, () => console.log('Keepalive server running'));

// ===== Ready =====
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ===== 管理者が設置するコマンド =====
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

      // 追加メンバーIDを整形
      const extraUserIds = rawIds.length
        ? rawIds
            .split(/[\s,、]+/)
            .map(s => s.trim())
            .filter(Boolean)
            .filter(id => /^\d{17,21}$/.test(id)) // IDっぽいものだけ
            .filter(id => id !== interaction.user.id)
        : [];

      // ===== 権限設定 =====
      const permissionOverwrites = [
        { id: interaction.guild.roles.everyone.id, deny:  [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id,                  allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        ...extraUserIds.map(uid => ({
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

      await interaction.editReply(`✅ チャンネル <#${channel.id}> を作成しました。`);
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