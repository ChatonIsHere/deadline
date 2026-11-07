import { Injectable } from '@nestjs/common';
import { Button, type ButtonContext, ComponentParam, Context } from 'necord';
import { CrewsService } from '../crews/crews.service';
import { lineMessage, lineReplacing } from './colours';
import { explain } from './gig.interactions';
import type { Said } from './voice';

/** Join and Decline on a crew invite DM. The DM is replaced by the answer. */
@Injectable()
export class CrewInteractions {
    constructor(private readonly crews: CrewsService) {}

    @Button('crew/accept/:crew/:runner')
    accept(@Context() [interaction]: ButtonContext, @ComponentParam('crew') crew: string, @ComponentParam('runner') runner: string) {
        return this.answer(interaction, () => this.crews.accept(interaction.user.id, crew, runner));
    }

    @Button('crew/decline/:crew/:runner')
    decline(@Context() [interaction]: ButtonContext, @ComponentParam('crew') crew: string, @ComponentParam('runner') runner: string) {
        return this.answer(interaction, () => this.crews.decline(interaction.user.id, crew, runner));
    }

    private async answer(interaction: ButtonContext[0], action: () => Promise<Said>) {
        try {
            await interaction.update(lineReplacing(await action()));
        } catch (err) {
            await interaction.reply(lineMessage(explain(err)));
        }
    }
}
